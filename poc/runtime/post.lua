wrk.method = "POST"
wrk.body = '{"name":"Ann","email":"ann@example.com","age":30}'
wrk.headers["Content-Type"] = "application/json"
wrk.headers["Authorization"] = "Bearer t-admin"
