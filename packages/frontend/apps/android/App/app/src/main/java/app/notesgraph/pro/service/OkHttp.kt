package app.notesgraph.pro.service

import app.notesgraph.pro.NotesGraphApp
import app.notesgraph.pro.CapacitorConfig
import app.notesgraph.pro.utils.TokenCipher
import app.notesgraph.pro.utils.dataStore
import app.notesgraph.pro.utils.del
import app.notesgraph.pro.utils.get
import app.notesgraph.pro.utils.set
import com.google.firebase.crashlytics.ktx.crashlytics
import com.google.firebase.ktx.Firebase
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.launch
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import timber.log.Timber
import java.util.concurrent.ConcurrentHashMap

object OkHttp {

    val client = OkHttpClient.Builder()
        .cookieJar(object : CookieJar {

            override fun loadForRequest(url: HttpUrl): List<Cookie> {
                val cookies = CookieStore.getCookies(url.host)
                Timber.d("load cookies: [ url = $url, cookies = $cookies]")
                return cookies
            }

            override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
                Timber.d("save cookies: [ url = $url, cookies = $cookies]")
                CookieStore.saveCookies(url.host, cookies)
            }
        })
        .addInterceptor {
            it.proceed(
                it.request()
                    .newBuilder()
                    .addHeader("x-notesgraph-version", CapacitorConfig.getNotesGraphVersion())
                    .build()
            )
        }
        .addInterceptor(HttpLoggingInterceptor { msg ->
            Timber.d(msg)
        }.apply {
            level = HttpLoggingInterceptor.Level.BODY
        })
        .build()

}

object AuthHttp {
    val client = OkHttpClient.Builder()
        .cookieJar(CookieJar.NO_COOKIES)
        .addInterceptor {
            it.proceed(
                it.request()
                    .newBuilder()
                    .addHeader("x-notesgraph-version", CapacitorConfig.getNotesGraphVersion())
                    .build()
            )
        }
        .build()
}

object CookieStore {

    const val NOTESGRAPH_SESSION = "notesgraph_session"
    const val NOTESGRAPH_USER_ID = "notesgraph_user_id"
    const val NOTESGRAPH_CSRF_TOKEN = "notesgraph_csrf_token"

    private val _cookies = ConcurrentHashMap<String, List<Cookie>>()

    fun saveCookies(host: String, cookies: List<Cookie>) {
        _cookies[host] = cookies
        MainScope().launch(Dispatchers.IO) {
            cookies.find { it.name == NOTESGRAPH_USER_ID }?.let {
                Timber.d("Update user id [${it.value}]")
                NotesGraphApp.context().dataStore.set(host + NOTESGRAPH_USER_ID, it.toString())
                Firebase.crashlytics.setUserId(it.value)
            }
            cookies.find { it.name == NOTESGRAPH_CSRF_TOKEN }?.let {
                NotesGraphApp.context().dataStore.set(host + NOTESGRAPH_CSRF_TOKEN, it.toString())
            }
            // Persist the long-lived session cookie (keystore-encrypted, like the
            // auth token) so the headless background-sync worker has a durable
            // credential after the app process dies — the in-memory _cookies map
            // and the 15-min JWT don't survive a closed app.
            cookies.find { it.name == NOTESGRAPH_SESSION }?.let {
                NotesGraphApp.context().dataStore.set(
                    host + NOTESGRAPH_SESSION,
                    TokenCipher().encrypt(it.value)
                )
            }
        }
    }

    fun getCookies(host: String) = _cookies[host] ?: emptyList()

    /**
     * The persisted (keystore-encrypted) `notesgraph_session` value for a host,
     * usable without the WebView. Prefers the live in-memory cookie, falling
     * back to the persisted one — so the background worker can authenticate the
     * sync socket for a closed app.
     */
    suspend fun readPersistedSessionCookie(host: String): String? {
        _cookies[host]?.find { it.name == NOTESGRAPH_SESSION }?.let {
            return it.value
        }
        val stored = NotesGraphApp.context().dataStore.get(host + NOTESGRAPH_SESSION)
        if (stored.isEmpty()) return null
        val cipher = TokenCipher()
        return cipher.decrypt(stored) ?: cipher.legacyPlaintext(stored)
    }

    fun clearAuthCookies(host: String) {
        val cookies = _cookies[host] ?: emptyList()
        _cookies[host] = cookies.filter {
            it.name != NOTESGRAPH_SESSION && it.name != NOTESGRAPH_USER_ID && it.name != NOTESGRAPH_CSRF_TOKEN
        }
        MainScope().launch(Dispatchers.IO) {
            NotesGraphApp.context().dataStore.del(host + NOTESGRAPH_USER_ID)
            NotesGraphApp.context().dataStore.del(host + NOTESGRAPH_CSRF_TOKEN)
            NotesGraphApp.context().dataStore.del(host + NOTESGRAPH_SESSION)
            Firebase.crashlytics.setUserId("")
        }
    }

    fun getCookie(url: HttpUrl, name: String) = url.host
        .let { _cookies[it] }
        ?.find { cookie -> cookie.name == name }
        ?.value
}
