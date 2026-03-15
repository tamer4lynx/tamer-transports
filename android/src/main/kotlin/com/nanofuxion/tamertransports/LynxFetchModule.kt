package com.nanofuxion.tamertransports

import android.content.Context
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
    }

    @LynxMethod
    fun request(url: String, optionsJson: String, callback: Callback) {
        Log.d(TAG, "Fetch request: $url")
        try {
            val options = JSONObject(optionsJson)
            val method = options.optString("method", "GET").uppercase()
            val headers = options.optJSONObject("headers")
            val body = options.optString("body", "")

            val builder = Request.Builder().url(url)

            if (headers != null) {
                val keys = headers.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    builder.addHeader(key, headers.getString(key))
                }
            }

            when (method) {
                "GET", "HEAD" -> builder.method(method, null)
                else -> {
                    val contentType = headers?.optString("Content-Type") ?: "text/plain; charset=utf-8"
                    val requestBody = body.toRequestBody(contentType.toMediaType())
                    builder.method(method, requestBody)
                }
            }

            val request = builder.build()

            client.newCall(request).execute().use { response ->
                val bodyStr = response.body?.string() ?: ""
                val headersObj = JSONObject()
                response.headers.forEach { (name, value) ->
                    headersObj.put(name, value)
                }

                val result = JSONObject().apply {
                    put("ok", response.isSuccessful)
                    put("status", response.code)
                    put("statusText", response.message)
                    put("headers", headersObj)
                    put("body", bodyStr)
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
