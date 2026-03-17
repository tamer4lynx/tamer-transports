package com.nanofuxion.tamertransports

import android.content.Context
import android.util.Base64
import android.util.Log
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException

class LynxFetchModule(context: Context) : LynxModule(context) {

    private val client = OkHttpClient()

    companion object {
        private const val TAG = "LynxFetchModule"
        private val BINARY_TYPES = setOf(
            "application/octet-stream",
            "application/pdf",
            "application/dns-message",
            "application/wasm",
            "image/",
            "audio/",
            "video/",
        )
    }

    private fun isBinaryContentType(contentType: String?): Boolean {
        if (contentType == null) return false
        return BINARY_TYPES.any { contentType.startsWith(it) }
    }

    @LynxMethod
    fun request(url: String, optionsJson: String, callback: Callback) {
        Log.d(TAG, "Fetch request: $url")
        try {
            val options = JSONObject(optionsJson)
            val method = options.optString("method", "GET").uppercase()
            val headers = options.optJSONObject("headers")
            val bodyStr = options.optString("body", "")
            val bodyBase64 = options.optString("bodyBase64", "")

            val builder = Request.Builder().url(url)

            if (headers != null) {
                val keys = headers.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    builder.addHeader(key, headers.getString(key))
                }
            }

            val requestBody = when (method) {
                "GET", "HEAD" -> null
                else -> {
                    when {
                        bodyBase64.isNotEmpty() -> {
                            val contentType = headers?.optString("Content-Type") ?: "application/octet-stream"
                            val bytes = Base64.decode(bodyBase64, Base64.NO_WRAP)
                            okhttp3.RequestBody.create(contentType.toMediaType(), bytes)
                        }
                        else -> {
                            val contentType = headers?.optString("Content-Type") ?: "text/plain; charset=utf-8"
                            bodyStr.toRequestBody(contentType.toMediaType())
                        }
                    }
                }
            }
            builder.method(method, requestBody)

            val request = builder.build()

            client.newCall(request).execute().use { response ->
                val contentType = response.header("Content-Type")
                val rawBody = response.body?.bytes()
                val headersObj = JSONObject()
                response.headers.forEach { (name, value) ->
                    headersObj.put(name, value)
                }

                val result = JSONObject().apply {
                    put("ok", response.isSuccessful)
                    put("status", response.code)
                    put("statusText", response.message)
                    put("headers", headersObj)
                }
                if (rawBody != null && rawBody.isNotEmpty() && isBinaryContentType(contentType)) {
                    result.put("bodyBase64", Base64.encodeToString(rawBody, Base64.NO_WRAP))
                } else {
                    result.put("body", rawBody?.toString(Charsets.UTF_8) ?: "")
                }
                callback.invoke(result.toString())
            }
        } catch (e: IOException) {
            Log.e(TAG, "Fetch error: ${e.message}")
            val errorResult = JSONObject().apply { put("error", e.message ?: "Network error") }
            callback.invoke(errorResult.toString())
        } catch (e: Exception) {
            Log.e(TAG, "Fetch error: ${e.message}")
            val errorResult = JSONObject().apply { put("error", e.message ?: "Unknown error") }
            callback.invoke(errorResult.toString())
        }
    }
}
