package app.notesgraph.pro.utils

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import timber.log.Timber
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Normalize an endpoint to `scheme://host[:port]` — the canonical form the auth
 * token is keyed by in DataStore. Shared by AuthPlugin and the background-sync
 * worker so both derive the same `auth-token:<endpoint>` key.
 */
internal fun canonicalEndpoint(endpoint: String): String = try {
    val url = endpoint.toHttpUrl()
    val port = if (url.port == HttpUrl.defaultPort(url.scheme)) "" else ":${url.port}"
    "${url.scheme}://${url.host}$port"
} catch (_: Exception) {
    endpoint
}

internal fun tokenKey(endpoint: String) = "auth-token:${canonicalEndpoint(endpoint)}"

/**
 * AES/GCM encryption of the session token, backed by an Android Keystore key.
 * Extracted from AuthPlugin so the headless background-sync worker can read the
 * same persisted token without the WebView.
 */
internal class TokenCipher {
    private val alias = "notesgraph-native-auth-token"
    private val transformation = "AES/GCM/NoPadding"

    fun encrypt(plaintext: String): String {
        val cipher = Cipher.getInstance(transformation)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val ciphertext = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        return listOf(
            "v1",
            Base64.encodeToString(cipher.iv, Base64.NO_WRAP),
            Base64.encodeToString(ciphertext, Base64.NO_WRAP),
        ).joinToString(":")
    }

    fun decrypt(encoded: String): String? {
        val parts = encoded.split(":")
        if (parts.size != 3 || parts[0] != "v1") {
            return null
        }

        return try {
            val iv = Base64.decode(parts[1], Base64.NO_WRAP)
            val ciphertext = Base64.decode(parts[2], Base64.NO_WRAP)
            val cipher = Cipher.getInstance(transformation)
            cipher.init(
                Cipher.DECRYPT_MODE,
                secretKey(),
                GCMParameterSpec(128, iv)
            )
            String(cipher.doFinal(ciphertext), Charsets.UTF_8)
        } catch (e: Exception) {
            Timber.w(e, "Failed to decrypt auth token.")
            null
        }
    }

    fun isEncrypted(value: String) = value.startsWith("v1:")

    fun legacyPlaintext(value: String) =
        value.takeIf { !isEncrypted(it) && it.isNotBlank() }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let {
            return it.secretKey
        }

        val keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore"
        )
        val spec = KeyGenParameterSpec.Builder(
            alias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build()
        keyGenerator.init(spec)
        return keyGenerator.generateKey()
    }
}
