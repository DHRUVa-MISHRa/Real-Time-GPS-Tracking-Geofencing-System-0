from flask import Flask,request,jsonify,render_template
import sqlite3,math
from datetime import datetime,timezone
app=Flask(__name__); DB="gps_tracking.db"; API_KEY="change-this-device-key"
def db():
 c=sqlite3.connect(DB); c.row_factory=sqlite3.Row; return c
def init():
 with db() as c:
  c.execute("CREATE TABLE IF NOT EXISTS locations(id INTEGER PRIMARY KEY,device_id TEXT,latitude REAL,longitude REAL,speed_kmph REAL,satellites INTEGER,hdop REAL,recorded_at TEXT)")
  c.execute("CREATE TABLE IF NOT EXISTS geofences(id INTEGER PRIMARY KEY,name TEXT,latitude REAL,longitude REAL,radius_m REAL)")
def dist(a,b,c,d):
 r=6371000;p1,p2=math.radians(a),math.radians(c);dp=math.radians(c-a);dl=math.radians(d-b)
 x=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
 return 2*r*math.atan2(math.sqrt(x),math.sqrt(1-x))
@app.get("/")
def home(): return render_template("index.html")
@app.get("/api/health")
def health(): return jsonify(ok=True)
@app.post("/api/location")
def receive():
 if request.headers.get("X-API-Key")!=API_KEY:return jsonify(error="Invalid API key"),401
 d=request.get_json(silent=True) or {}
 try:
  dev=str(d["device_id"]);lat=float(d["latitude"]);lon=float(d["longitude"])
  speed=float(d.get("speed_kmph",0));sat=int(d.get("satellites",0));hdop=float(d.get("hdop",0))
  if not(-90<=lat<=90 and -180<=lon<=180):raise ValueError()
 except (KeyError,TypeError,ValueError):return jsonify(error="Invalid GPS fields"),400
 stamp=datetime.now(timezone.utc).isoformat(timespec="seconds")
 with db() as c:
  cur=c.execute("INSERT INTO locations(device_id,latitude,longitude,speed_kmph,satellites,hdop,recorded_at) VALUES(?,?,?,?,?,?,?)",(dev,lat,lon,speed,sat,hdop,stamp))
  fs=c.execute("SELECT * FROM geofences").fetchall()
 states=[{"id":f["id"],"name":f["name"],"inside":dist(lat,lon,f["latitude"],f["longitude"])<=f["radius_m"]} for f in fs]
 return jsonify(ok=True,id=cur.lastrowid,recorded_at=stamp,geofences=states),201
@app.get("/api/latest")
def latest():
 with db() as c:r=c.execute("SELECT * FROM locations ORDER BY id DESC LIMIT 1").fetchone()
 return jsonify(dict(r) if r else {})
@app.get("/api/history")
def history():
 n=min(max(request.args.get("limit",100,type=int),1),1000)
 with db() as c:rs=c.execute("SELECT * FROM locations ORDER BY id DESC LIMIT ?",(n,)).fetchall()
 return jsonify([dict(x) for x in rs])
@app.get("/api/geofences")
def fences():
 with db() as c:rs=c.execute("SELECT * FROM geofences").fetchall()
 return jsonify([dict(x) for x in rs])
@app.post("/api/geofences")
def addf():
 d=request.get_json(silent=True) or {}
 try:
  name=str(d.get("name","Safe Zone"));lat=float(d["latitude"]);lon=float(d["longitude"]);rad=float(d.get("radius_m",100))
  if not(-90<=lat<=90 and -180<=lon<=180 and 5<=rad<=100000):raise ValueError()
 except (KeyError,TypeError,ValueError):return jsonify(error="Invalid geofence values"),400
 with db() as c:cur=c.execute("INSERT INTO geofences(name,latitude,longitude,radius_m) VALUES(?,?,?,?)",(name,lat,lon,rad))
 return jsonify(ok=True,id=cur.lastrowid),201
@app.delete("/api/geofences/<int:i>")
def delf(i):
 with db() as c:c.execute("DELETE FROM geofences WHERE id=?",(i,))
 return jsonify(ok=True)
if __name__=="__main__":
 init();print("Dashboard: http://127.0.0.1:5000");app.run(host="0.0.0.0",port=5000)
