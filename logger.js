// ========================================================================
// ORBIT MESSENGER - CLIENT-SIDE ERROR LOGGER (js/logger.js)
// Zero-dependency, standalone error logging module communicating directly
// with the Supabase REST API via keepalive fetch.
// ========================================================================

(function () {
    'use strict';

    const SB_REST_URL = 'https://dhtbiggamuwoqurguhib.supabase.co/rest/v1/error_logs';
    const SB_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRodGJpZ2dhbXV3b3F1cmd1aGliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMxNzY2MzksImV4cCI6MjA3ODc1MjYzOX0.-utin9W_-hSeijdHwcVSjft9biB5DSXrNOmuz5kCPlE';

    // In-memory deduplication cache: keeps error signatures for 60 seconds
    const _dedupCache = new Map();
    const DEDUP_WINDOW_MS = 60000;

    /**
     * Safely extracts current user ID from localStorage without blocking
     */
    function getCurrentUserId() {
        try {
            // Check Orbit cached user
            const orbitUser = localStorage.getItem('orbit_current_user');
            if (orbitUser) {
                const parsed = JSON.parse(orbitUser);
                if (parsed && (parsed.id || parsed.user_id)) return parsed.id || parsed.user_id;
            }
            // Check Supabase standard auth token in localStorage
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && ((k.startsWith('sb-') && k.endsWith('-auth-token')) || k === 'supabase.auth.token')) {
                    const raw = localStorage.getItem(k);
                    if (raw) {
                        const parsed = JSON.parse(raw);
                        if (parsed && parsed.user && parsed.user.id) return parsed.user.id;
                    }
                }
            }
        } catch (e) {
            // ignore localStorage parsing errors
        }
        return null;
    }

    /**
     * Sends the error log payload directly to Supabase REST API via fetch
     */
    async function sendErrorToSupabase(payload) {
        try {
            // Compute deduplication key
            const dedupKey = `${payload.error_source || ''}|${payload.error_message || ''}|${payload.error_stack || ''}`;
            const now = Date.now();
            const lastSent = _dedupCache.get(dedupKey);
            if (lastSent && (now - lastSent) < DEDUP_WINDOW_MS) {
                // Duplicate error within debounce window; drop to protect database
                return;
            }
            _dedupCache.set(dedupKey, now);

            // Cleanup old keys periodically if cache grows
            if (_dedupCache.size > 200) {
                for (const [k, ts] of _dedupCache.entries()) {
                    if (now - ts > DEDUP_WINDOW_MS) _dedupCache.delete(k);
                }
            }

            // Error reports belong to the active account. Using the anonymous
            // key as the JWT makes authenticated error_logs policies reject
            // reports even when the person is signed in to Orbit.
            const client = window.getSupabase?.();
            const sessionResult = client?.auth ? await client.auth.getSession() : null;
            const activeSession = sessionResult?.data?.session;
            if (activeSession?.user?.id) payload.user_id = activeSession.user.id;
            const body = JSON.stringify(payload);

            const response = await fetch(SB_REST_URL, {
                method: 'POST',
                headers: {
                    'apikey': SB_ANON_KEY,
                    'Authorization': `Bearer ${activeSession?.access_token || SB_ANON_KEY}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                body: body,
                keepalive: true
            });
            if (!response.ok) console.warn(`[Logger] Error report rejected (HTTP ${response.status}).`);
        } catch (e) {
            console.warn('[Logger] Exception during error dispatch:', e);
        }
    }

    /**
     * Public Logger API exposed on window.Logger
     */
    window.Logger = {
        /**
         * Captures an exception manually with optional context
         * @param {Error|string} err 
         * @param {Object} [context] 
         */
        captureException: function (err, context) {
            try {
                let message = 'Unknown Error';
                let stack = '';
                let source = 'manual_capture';

                if (err instanceof Error) {
                    message = err.message || err.name || 'Error';
                    stack = err.stack || '';
                } else if (typeof err === 'string') {
                    message = err;
                } else if (err && typeof err === 'object') {
                    message = err.message || JSON.stringify(err);
                    stack = err.stack || '';
                }

                const payload = {
                    error_message: String(message).substring(0, 2000),
                    error_stack: stack ? String(stack).substring(0, 5000) : null,
                    error_source: source,
                    user_agent: navigator.userAgent ? navigator.userAgent.substring(0, 500) : null,
                    route: window.location ? (window.location.pathname + window.location.hash) : '/',
                    user_id: getCurrentUserId(),
                    metadata: {
                        timestamp: new Date().toISOString(),
                        is_online: navigator.onLine !== false,
                        screen: `${window.innerWidth}x${window.innerHeight}`,
                        context: context || {}
                    }
                };

                sendErrorToSupabase(payload);
            } catch (e) {
                console.warn('[Logger] captureException failed:', e);
            }
        }
    };

    // ── 1. Global window.onerror Listener ──
    window.onerror = function (message, source, lineno, colno, error) {
        try {
            const stack = (error && error.stack) ? error.stack : '';
            const msgStr = typeof message === 'string' ? message : (error ? error.message : 'Unknown error');
            const fileOrigin = source ? `${source}:${lineno || 0}:${colno || 0}` : 'window.onerror';

            const payload = {
                error_message: String(msgStr).substring(0, 2000),
                error_stack: stack ? String(stack).substring(0, 5000) : null,
                error_source: fileOrigin.substring(0, 1000),
                user_agent: navigator.userAgent ? navigator.userAgent.substring(0, 500) : null,
                route: window.location ? (window.location.pathname + window.location.hash) : '/',
                user_id: getCurrentUserId(),
                metadata: {
                    lineno: lineno || null,
                    colno: colno || null,
                    is_online: navigator.onLine !== false,
                    screen: `${window.innerWidth}x${window.innerHeight}`,
                    type: 'uncaught_exception'
                }
            };

            sendErrorToSupabase(payload);
        } catch (e) {
            console.warn('[Logger] onerror handler error:', e);
        }
        return false; // Do not suppress default browser console reporting
    };

    // ── 2. Unhandled Promise Rejections Listener ──
    window.addEventListener('unhandledrejection', function (event) {
        try {
            const reason = event.reason;
            let message = 'Unhandled Promise Rejection';
            let stack = '';

            if (reason instanceof Error) {
                message = reason.message || reason.name || 'Promise Error';
                stack = reason.stack || '';
            } else if (typeof reason === 'string') {
                message = reason;
            } else if (reason && typeof reason === 'object') {
                message = reason.message || JSON.stringify(reason);
                stack = reason.stack || '';
            }

            const payload = {
                error_message: String(message).substring(0, 2000),
                error_stack: stack ? String(stack).substring(0, 5000) : null,
                error_source: 'unhandled_rejection',
                user_agent: navigator.userAgent ? navigator.userAgent.substring(0, 500) : null,
                route: window.location ? (window.location.pathname + window.location.hash) : '/',
                user_id: getCurrentUserId(),
                metadata: {
                    is_online: navigator.onLine !== false,
                    screen: `${window.innerWidth}x${window.innerHeight}`,
                    type: 'unhandled_rejection'
                }
            };

            sendErrorToSupabase(payload);
        } catch (e) {
            console.warn('[Logger] unhandledrejection handler error:', e);
        }
    });

    console.log('[Orbit Logger] Automated client error tracking active ✓');
})();
