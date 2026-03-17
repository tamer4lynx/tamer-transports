package com.nanofuxion.tamertransports

import android.content.Context
import android.util.Base64
import android.util.Log
import com.lynx.jsbridge.LynxMethod
import com.lynx.jsbridge.LynxModule
import com.lynx.react.bridge.Callback
import com.lynx.react.bridge.JavaOnlyArray
import com.lynx.react.bridge.JavaOnlyMap
import com.lynx.tasm.behavior.LynxContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Call
import okhttp3.Callback as OkHttpCallback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap

class LynxFetchModule(context: Context) : LynxModule(context) {

    private val client = OkHttpClient()
    private val activeCalls = ConcurrentHashMap<Int, Call>()

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
            val stream = options.optBoolean("stream", false)
            val requestId = options.optInt("requestId", -1)

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
            val call = client.newCall(request)
            if (stream && requestId >= 0) {
                activeCalls[requestId] = call
                call.enqueue(object : OkHttpCallback {
                    override fun onFailure(call: Call, e: IOException) {
                        activeCalls.remove(requestId)
                        callback.invoke(JSONObject().apply {
                            put("event", "error")
                            put("message", e.message ?: "Network error")
                        }.toString())
                    }

                    override fun onResponse(call: Call, response: Response) {
                        activeCalls.remove(requestId)
                        response.use {
                            val headersObj = JSONObject()
                            response.headers.forEach { (name, value) ->
                                headersObj.put(name, value)
                            }
                            callback.invoke(JSONObject().apply {
                                put("event", "headers")
                                put("ok", response.isSuccessful)
                                put("status", response.code)
                                put("statusText", response.message)
                                put("headers", headersObj)
                            }.toString())

                            val streamBody = response.body?.byteStream() ?: run {
                                callback.invoke(JSONObject().put("event", "end").toString())
                                return
                            }
                            val buffer = ByteArray(8192)
                            while (true) {
                                val read = streamBody.read(buffer)
                                if (read <= 0) break
                                callback.invoke(JSONObject().apply {
                                    put("event", "chunk")
                                    put("dataBase64", Base64.encodeToString(buffer.copyOf(read), Base64.NO_WRAP))
                                }.toString())
                            }
                            callback.invoke(JSONObject().put("event", "end").toString())
                        }
                    }
                })
                return
            }

            call.execute().use { response ->
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

    @LynxMethod
    fun cancel(requestId: Int) {
        activeCalls.remove(requestId)?.cancel()
    }
}
