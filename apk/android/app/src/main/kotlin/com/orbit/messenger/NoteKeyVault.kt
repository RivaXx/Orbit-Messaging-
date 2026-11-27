package com.orbit.messenger

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal class NoteKeyVault(private val activity: FragmentActivity) {
    private val preferences = activity.getSharedPreferences("orbit-note-keys-v1", 0)
    private val keys = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private var busy = false

    fun authenticate(account: String, id: String, raw: String?, complete: (Result<String>) -> Unit) {
        check(!busy) { "A Notes biometric prompt is already open." }
        val uid = Regex("[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}")
        require(uid.matches(account) && uid.matches(id))
        val strength = BiometricManager.Authenticators.BIOMETRIC_STRONG
        check(BiometricManager.from(activity).canAuthenticate(strength) == BiometricManager.BIOMETRIC_SUCCESS) {
            "Set up a supported fingerprint or face unlock, or use your recovery passphrase."
        }
        val alias = "orbit-note-v1-$account"
        val tag = "$account:$id"
        val encrypted = if (raw == null) {
            preferences.getString(tag,null)?.split('.',limit=2) ?: error("Use the recovery passphrase to set up biometrics on this phone.")
        } else null
        val originalKey = keys.getKey(alias,null) as? SecretKey
        val key = originalKey ?: run {
            if (raw == null) error("The saved key is unavailable. Use your recovery passphrase.")
            val builder = KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setUserAuthenticationRequired(true)
                .setInvalidatedByBiometricEnrollment(false)
            if (Build.VERSION.SDK_INT >= 30) builder.setUserAuthenticationParameters(0,KeyProperties.AUTH_BIOMETRIC_STRONG)
            else builder.setUserAuthenticationValidityDurationSeconds(-1)
            KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").run {
                init(builder.build()); generateKey()
            }
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            if (encrypted == null) init(Cipher.ENCRYPT_MODE,key)
            else init(Cipher.DECRYPT_MODE,key,GCMParameterSpec(128,decode(encrypted[0])))
        }
        val source = if (encrypted == null) decode(raw ?: "") else decode(encrypted[1])
        require(source.size == if (encrypted == null) 32 else 48)
        val prompt = BiometricPrompt(activity,ContextCompat.getMainExecutor(activity),object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                busy = false
                val response = runCatching {
                    val approved = result.cryptoObject?.cipher ?: error("Biometric authorization missing.")
                    approved.updateAAD(tag.toByteArray())
                    val output = approved.doFinal(source)
                    try {
                        if (encrypted == null) {
                            check(preferences.edit().putString(tag,encode(approved.iv) + "." + encode(output)).commit())
                            "remembered"
                        } else encode(output)
                    } finally { output.fill(0);source.fill(0) }
                }
                source.fill(0)
                complete(response)
            }
            override fun onAuthenticationError(code: Int, message: CharSequence) {
                busy = false
                source.fill(0)
                complete(Result.failure(IllegalStateException("Biometric unlock cancelled. Use your recovery passphrase.")))
            }
        })
        busy = true
        try {
            prompt.authenticate(BiometricPrompt.PromptInfo.Builder().setTitle(if (raw == null) "Unlock Orbit note" else "Enable note biometrics")
                .setAllowedAuthenticators(strength).setNegativeButtonText("Use passphrase").build(),BiometricPrompt.CryptoObject(cipher))
        } catch (failure: Exception) {
            busy = false
            source.fill(0)
            throw failure
        }
    }
    private fun encode(input: ByteArray) = Base64.encodeToString(input,Base64.NO_WRAP)
    private fun decode(input: String) = Base64.decode(input,Base64.NO_WRAP)
}
