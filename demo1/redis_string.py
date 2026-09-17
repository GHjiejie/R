from redis import Redis

r = Redis(host="localhost", port=6379, db=0, decode_responses=True)

r.set("mykey", "Hello, Redis!", ex=10)

print(r.get("mykey"))

ttl = r.ttl("mykey")

print(f"Time to live for 'mykey': {ttl} seconds")
