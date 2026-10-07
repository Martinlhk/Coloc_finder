import json
import os
import sqlite3
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

from flask import Flask, jsonify, render_template, request


app = Flask(__name__)
DATABASE = Path(os.environ.get("DATABASE_PATH", "data/colocations.sqlite3"))
PALETTE = ["#167d78", "#d96843", "#5477b8", "#bc8b22", "#8b65a9", "#4f8b57", "#d05a7c", "#65717e"]
OFFICE = {
    "name": "Office",
    "address": "480 Avenue Louise, 1050 Brussels, Belgium",
    "latitude": 50.8171126,
    "longitude": 4.3720834,
}
search_lock = threading.Lock()
last_search_at = 0.0


def connect_db():
    DATABASE.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_db():
    with connect_db() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS labels (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                color TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS places (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                address TEXT NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                notes TEXT NOT NULL DEFAULT '',
                label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE RESTRICT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS geocode_cache (
                query TEXT PRIMARY KEY COLLATE NOCASE,
                results TEXT NOT NULL
            );
            """
        )
        columns = {row["name"] for row in db.execute("PRAGMA table_info(places)")}
        for column in ("contact_person", "link"):
            if column not in columns:
                db.execute(f"ALTER TABLE places ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")
        defaults = [
            ("To visit", PALETTE[0]),
            ("Shortlisted", PALETTE[1]),
            ("Contacted", PALETTE[3]),
            ("Visited", PALETTE[5]),
            ("Not interested", PALETTE[7]),
        ]
        db.executemany("INSERT OR IGNORE INTO labels (name, color) VALUES (?, ?)", defaults)


def get_places():
    with connect_db() as db:
        rows = db.execute(
            """SELECT p.*, l.name AS label, l.color AS color
               FROM places p JOIN labels l ON l.id = p.label_id ORDER BY p.id DESC"""
        ).fetchall()
        return [dict(row) for row in rows]


def get_labels():
    with connect_db() as db:
        rows = db.execute("SELECT id, name, color FROM labels ORDER BY name COLLATE NOCASE").fetchall()
        return [dict(row) for row in rows]


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/places")
def places_api():
    return jsonify(get_places())


@app.post("/api/places")
def create_place():
    data = request.get_json(force=True)
    required = ("name", "address", "latitude", "longitude", "label_id")
    if any(not str(data.get(key, "")).strip() for key in required):
        return jsonify(error="Name, address, coordinates, and one label are required."), 400
    try:
        latitude, longitude = float(data["latitude"]), float(data["longitude"])
        label_id = int(data["label_id"])
    except (TypeError, ValueError):
        return jsonify(error="Choose a valid location and label."), 400
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return jsonify(error="Coordinates are outside the valid range."), 400
    link = str(data.get("link", "")).strip()
    if link and (urllib.parse.urlsplit(link).scheme not in ("http", "https") or not urllib.parse.urlsplit(link).netloc):
        return jsonify(error="Link must start with http:// or https://."), 400
    with connect_db() as db:
        if not db.execute("SELECT 1 FROM labels WHERE id=?", (label_id,)).fetchone():
            return jsonify(error="Choose an existing label."), 400
        cursor = db.execute(
            """INSERT INTO places (name, address, latitude, longitude, notes, label_id, contact_person, link)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (data["name"].strip(), data["address"].strip(), latitude, longitude,
             str(data.get("notes", "")).strip(), label_id,
             str(data.get("contact_person", "")).strip(), link),
        )
        place_id = cursor.lastrowid
    return jsonify(next(place for place in get_places() if place["id"] == place_id)), 201


@app.put("/api/places/<int:place_id>")
def update_place(place_id):
    data = request.get_json(force=True)
    required = ("name", "address", "latitude", "longitude", "label_id")
    if any(not str(data.get(key, "")).strip() for key in required):
        return jsonify(error="Name, address, coordinates, and one label are required."), 400
    try:
        latitude, longitude = float(data["latitude"]), float(data["longitude"])
        label_id = int(data["label_id"])
    except (TypeError, ValueError):
        return jsonify(error="Choose a valid location and label."), 400
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return jsonify(error="Coordinates are outside the valid range."), 400
    link = str(data.get("link", "")).strip()
    if link and (urllib.parse.urlsplit(link).scheme not in ("http", "https") or not urllib.parse.urlsplit(link).netloc):
        return jsonify(error="Link must start with http:// or https://."), 400
    with connect_db() as db:
        if not db.execute("SELECT 1 FROM labels WHERE id=?", (label_id,)).fetchone():
            return jsonify(error="Choose an existing label."), 400
        cursor = db.execute(
            """UPDATE places SET name=?, address=?, latitude=?, longitude=?, notes=?, label_id=?, contact_person=?, link=?
               WHERE id=?""",
            (data["name"].strip(), data["address"].strip(), latitude, longitude,
             str(data.get("notes", "")).strip(), label_id,
             str(data.get("contact_person", "")).strip(), link, place_id),
        )
        if cursor.rowcount == 0:
            return jsonify(error="Place not found."), 404
    return jsonify(next(place for place in get_places() if place["id"] == place_id))


@app.delete("/api/places/<int:place_id>")
def delete_place(place_id):
    with connect_db() as db:
        cursor = db.execute("DELETE FROM places WHERE id=?", (place_id,))
        if cursor.rowcount == 0:
            return jsonify(error="Place not found."), 404
    return "", 204


@app.get("/api/labels")
def labels_api():
    return jsonify(get_labels())


@app.post("/api/labels")
def create_label():
    data = request.get_json(force=True)
    name = str(data.get("name", "")).strip()
    if not name or len(name) > 32:
        return jsonify(error="Enter a label name of 1 to 32 characters."), 400
    color = data.get("color")
    if color not in PALETTE:
        return jsonify(error="Choose a color from the palette."), 400
    try:
        with connect_db() as db:
            cursor = db.execute("INSERT INTO labels (name, color) VALUES (?, ?)", (name, color))
            label_id = cursor.lastrowid
    except sqlite3.IntegrityError:
        return jsonify(error="That label already exists."), 409
    return jsonify(next(label for label in get_labels() if label["id"] == label_id)), 201


@app.delete("/api/labels/<int:label_id>")
def delete_label(label_id):
    with connect_db() as db:
        try:
            cursor = db.execute("DELETE FROM labels WHERE id=?", (label_id,))
        except sqlite3.IntegrityError:
            return jsonify(error="Move places to another label before deleting this one."), 409
        if cursor.rowcount == 0:
            return jsonify(error="Label not found."), 404
    return "", 204


@app.get("/api/search")
def search_places():
    global last_search_at
    query = request.args.get("q", "").strip()
    if len(query) < 3:
        return jsonify(error="Enter at least 3 characters to search."), 400
    with connect_db() as db:
        cached = db.execute("SELECT results FROM geocode_cache WHERE query=?", (query,)).fetchone()
    if cached:
        return jsonify(json.loads(cached["results"]))
    with search_lock:
        delay = 1.0 - (time.monotonic() - last_search_at)
        if delay > 0:
            time.sleep(delay)
        last_search_at = time.monotonic()
    params = urllib.parse.urlencode({
        "q": f"{query}, Brussels, Belgium", "format": "jsonv2", "limit": 5,
        "countrycodes": "be", "viewbox": "4.20,50.92,4.55,50.75", "bounded": 1,
    })
    req = urllib.request.Request(
        f"https://nominatim.openstreetmap.org/search?{params}",
        headers={"User-Agent": "ColocFinder/1.0 (local personal app; place search)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            results = [
                {
                    "name": item.get("name") or item["display_name"].split(",")[0],
                    "address": item["display_name"],
                    "latitude": float(item["lat"]),
                    "longitude": float(item["lon"]),
                }
                for item in json.load(response)
            ]
    except Exception:
        return jsonify(error="Place search is temporarily unavailable. Try again shortly."), 502
    with connect_db() as db:
        db.execute("INSERT OR REPLACE INTO geocode_cache (query, results) VALUES (?, ?)",
                   (query, json.dumps(results)))
    return jsonify(results)


@app.get("/api/config")
def config_api():
    return jsonify(office=OFFICE, palette=PALETTE)


initialize_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
