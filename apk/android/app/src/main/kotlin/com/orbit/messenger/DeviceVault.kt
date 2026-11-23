package com.orbit.messenger

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal class DeviceVault(context: Context) {
    private val state = context.getSharedPreferences("orbit-device-v1", Context.MODE_PRIVATE)
    private val keys = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private val random = SecureRandom()
    val hasPin: Boolean get() = state.contains("pinTag")

    private fun key(alias: String, algorithm: String, purposes: Int): SecretKey {
        (keys.getKey(alias, null) as? SecretKey)?.let { return it }
        val params = KeyGenParameterSpec.Builder(alias, purposes).setKeySize(256)
        if (algorithm == KeyProperties.KEY_ALGORITHM_AES) {
            params.setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            params.setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        } else {
            params.setDigests(KeyProperties.DIGEST_SHA256)
        }
        return KeyGenerator.getInstance(algorithm, "AndroidKeyStore").run {
            init(params.build())
            generateKey()
        }
    }

    private fun tag(pin: String, salt: ByteArray): ByteArray = Mac.getInstance("HmacSHA256").run {
        init(key("orbit-pin-v1", KeyProperties.KEY_ALGORITHM_HMAC_SHA256, KeyProperties.PURPOSE_SIGN))
        update(salt)
        doFinal(pin.toByteArray())
    }

    fun setPin(pin: String) {
        require(Regex("[0-9]{4}").matches(pin)) { "Use four digits." }
        require(pin.toSet().size > 1 && pin !in setOf("1234", "4321", "0123", "9876", "1212", "1122", "2580")) {
            "Choose a less predictable PIN."
        }
        val salt = ByteArray(32).also(random::nextBytes)
        check(state.edit().putString("pinSalt", encode(salt)).putString("pinTag", encode(tag(pin, salt)))
            .remove("failures").remove("blockedUntil").commit()) { "The PIN could not be saved." }
    }

    fun verify(pin: String): String? {
        val remaining = state.getLong("blockedUntil", 0) - System.currentTimeMillis()
        if (remaining > 0) return "Try again in ${(remaining + 999) / 1000} seconds or use biometrics."
        val saved = state.getString("pinTag", null) ?: return "Set up your Orbit PIN first."
        val salt = state.getString("pinSalt", null) ?: return "Your Orbit PIN could not be opened."
        if (MessageDigest.isEqual(decode(saved), tag(pin, decode(salt)))) {
            clearFailures()
            return null
        }
        val failures = state.getInt("failures", 0) + 1
        val seconds = if (failures < 5) 0L else (30L shl (failures - 5).coerceAtMost(7)).coerceAtMost(3600L)
        check(state.edit().putInt("failures", failures)
            .putLong("blockedUntil", System.currentTimeMillis() + seconds * 1000L).commit())
        return if (seconds == 0L) "PIN does not match." else "Try again in $seconds seconds or use biometrics."
    }

    fun clearFailures() { state.edit().remove("failures").remove("blockedUntil").commit() }

    fun remember(account: String, identity: JSONObject) {
        val record = identity.getJSONObject("record")
        val box = identity.getJSONObject("deviceIdentity")
        require(record.getString("user_id") == account && box.getInt("version") == 1)
        require(box.getString("secret").length == 43 && box.getString("iv").length == 16 && box.getString("ciphertext").length in 1..68000)
        val entry = JSONObject().put("record", record).put("deviceIdentity", box)
        val cipher = cipher(Cipher.ENCRYPT_MODE, account)
        val bytes = entry.toString().toByteArray()
        try {
            check(state.edit().putString("chat-$account", encode(cipher.iv) + "." + encode(cipher.doFinal(bytes))).commit())
        } finally { bytes.fill(0) }
    }

    fun restore(account: String): JSONObject? {
        val saved = state.getString("chat-$account", null)?.split('.', limit = 2) ?: return null
        val bytes = cipher(Cipher.DECRYPT_MODE, account, decode(saved[0])).doFinal(decode(saved[1]))
        val entry = try { JSONObject(String(bytes)) } finally { bytes.fill(0) }
        if (entry.has("deviceIdentity")) return entry
        val age = System.currentTimeMillis() - entry.getLong("savedAt")
        if (age < 0 || age >= 7 * 24 * 60 * 60 * 1000L) {
            forget(account)
            return null
        }
        return entry
    }

    fun forget(account: String) { check(state.edit().remove("chat-$account").commit()) }

    private fun cipher(mode: Int, account: String, iv: ByteArray? = null): Cipher {
        val key = key("orbit-chat-v1", KeyProperties.KEY_ALGORITHM_AES, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        return Cipher.getInstance("AES/GCM/NoPadding").apply {
            if (iv == null) init(mode, key) else init(mode, key, GCMParameterSpec(128, iv))
            updateAAD(account.toByteArray())
        }
    }

    private fun encode(value: ByteArray) = Base64.encodeToString(value, Base64.NO_WRAP)
    private fun decode(value: String) = Base64.decode(value, Base64.NO_WRAP)
}
