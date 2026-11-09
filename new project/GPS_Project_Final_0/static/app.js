const API = {
    latest: "/api/latest",
    history: "/api/history?limit=100",
    geofences: "/api/geofences",
    health: "/api/health"
};

let map = null;
let gpsMarker = null;
let routeLine = null;
let geofenceLayers = [];
let refreshTimer = null;

const elements = {
    latitude: ["latitude", "lat"],
    longitude: ["longitude", "lon", "lng"],
    speed: ["speed", "speed_kmph"],
    satellites: ["satellites", "sats"],
    hdop: ["hdop"],
    time: ["recorded_at", "timestamp", "updated"],
    status: ["gps-status", "status"],
    distance: ["distance", "distance_from_home"],
    geofence: ["geofence-status", "geofence_status"],
    device: ["device_id", "device-id"]
};

function getElement(names) {
    for (const name of names) {
        const element = document.getElementById(name);
        if (element) return element;
    }
    return null;
}

function updateText(names, value) {
    const element = getElement(names);
    if (element) element.textContent = value == null ? "" : String(value);
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const earthRadius = 6371000;
    const toRadians = value => value * Math.PI / 180;
    const latitudeDelta = toRadians(lat2 - lat1);
    const longitudeDelta = toRadians(lon2 - lon1);
    const a =
        Math.sin(latitudeDelta / 2) ** 2 +
        Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(longitudeDelta / 2) ** 2;

    return 2 * earthRadius * Math.atan2(
        Math.sqrt(a),
        Math.sqrt(1 - a)
    );
}

function initializeMap() {
    const mapElement = document.getElementById("map");

    if (!mapElement || typeof L === "undefined") {
        console.warn("Map element or Leaflet library not found.");
        return;
    }

    if (map) return;

    map = L.map(mapElement).setView([20.5937, 78.9629], 5);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 19
    }).addTo(map);
    routeLine = L.polyline([], {
        color: "blue",
        weight: 4
    }).addTo(map);
}

async function loadGeofences() {
    const response = await fetch(API.geofences, { cache: "no-store" });
    if (!response.ok) throw new Error(`Geofence API error (${response.status})`);

    const fences = await response.json();
    if (!Array.isArray(fences)) {
        throw new Error("Geofence API returned an invalid response.");
    }

    geofenceLayers.forEach(layer => {
        if (map) map.removeLayer(layer);
    });
    geofenceLayers = [];

    const fenceList = document.getElementById("fences");
    if (fenceList) fenceList.replaceChildren();

    fences.forEach(fence => {
        if (map && Number.isFinite(Number(fence.latitude)) &&
            Number.isFinite(Number(fence.longitude)) &&
            Number.isFinite(Number(fence.radius_m))) {
            const circle = L.circle(
                [Number(fence.latitude), Number(fence.longitude)],
                {
                    radius: Number(fence.radius_m),
                    color: "green",
                    fillOpacity: 0.12
                }
            ).addTo(map);
            circle.bindPopup(`${fence.name} (${fence.radius_m} meters)`);
            geofenceLayers.push(circle);
        }

        if (fenceList) {
            const row = document.createElement("div");
            row.className = "fence";

            const label = document.createElement("span");
            label.textContent = `${fence.name} (${fence.radius_m}m)`;
            row.appendChild(label);

            if (fence.id != null) {
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = "Delete";
                button.dataset.id = fence.id;
                row.appendChild(button);
            }

            fenceList.appendChild(row);
        }
    });

    return fences;
}

function checkGeofence(location, fences) {
    if (!fences || fences.length === 0) {
        updateText(elements.geofence, "No geofence configured");
        updateText(elements.distance, "N/A");
        return;
    }

    const results = fences.map(fence => {
        const distance = calculateDistance(
            location.latitude,
            location.longitude,
            Number(fence.latitude),
            Number(fence.longitude)
        );

        return {
            name: fence.name,
            distance,
            inside: distance <= Number(fence.radius_m)
        };
    });
    const insideFences = results.filter(result => result.inside);

    updateText(
        elements.geofence,
        insideFences.length
            ? `INSIDE - ${insideFences.map(fence => fence.name).join(", ")}`
            : "OUTSIDE - Geofence Alert"
    );

    const nearest = results.reduce((closest, current) =>
        current.distance < closest.distance ? current : closest
    );
    updateText(
        elements.distance,
        `${nearest.distance.toFixed(2)} m from ${nearest.name}`
    );
}

function updateMap(location) {
    if (!map) return;

    const position = [location.latitude, location.longitude];
    if (!gpsMarker) {
        gpsMarker = L.marker(position).addTo(map);
        gpsMarker.bindPopup("Current GPS Location");
    } else {
        gpsMarker.setLatLng(position);
    }

    gpsMarker.setPopupContent(
        `Device: ${location.device_id || "Unknown"}<br>` +
        `Latitude: ${location.latitude}<br>` +
        `Longitude: ${location.longitude}`
    );
    map.setView(position, 16);

    const lastPosition = routeLine.getLatLngs().slice(-1)[0];
    if (!lastPosition ||
        lastPosition.lat !== position[0] ||
        lastPosition.lng !== position[1]) {
        routeLine.addLatLng(position);
    }
}

async function loadLatestLocation() {
    try {
        const response = await fetch(API.latest, { cache: "no-store" });
        if (!response.ok) throw new Error(`Latest API error (${response.status})`);

        const location = await response.json();
        const latitude = Number(location && location.latitude);
        const longitude = Number(location && location.longitude);

        if (!location || !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)) {
            updateText(elements.status, "Waiting for GPS data...");
            return;
        }

        location.latitude = latitude;
        location.longitude = longitude;

        updateText(elements.latitude, latitude.toFixed(6));
        updateText(elements.longitude, longitude.toFixed(6));
        updateText(elements.speed, (Number(location.speed_kmph) || 0).toFixed(2));
        updateText(elements.satellites, location.satellites);
        updateText(elements.hdop, location.hdop);
        updateText(
            elements.time,
            location.recorded_at
                ? `Last update: ${new Date(location.recorded_at).toLocaleString()}`
                : ""
        );
        updateText(elements.device, location.device_id);
        updateText(elements.status, "GPS Connected");

        updateMap(location);

        const fences = await loadGeofences();
        checkGeofence(location, fences);
    } catch (error) {
        console.error("GPS update failed:", error);
        updateText(elements.status, "Server connection error");
    }
}

async function loadHistory() {
    try {
        const response = await fetch(API.history, { cache: "no-store" });
        if (!response.ok) throw new Error(`History API error (${response.status})`);

        const history = await response.json();
        if (!Array.isArray(history)) {
            throw new Error("History API returned an invalid response.");
        }

        const validPoints = history
            .filter(item =>
                Number.isFinite(Number(item.latitude)) &&
                Number.isFinite(Number(item.longitude))
            )
            .reverse();

        if (routeLine) {
            routeLine.setLatLngs(validPoints.map(item => [
                Number(item.latitude),
                Number(item.longitude)
            ]));
        }

        const historyElement = document.getElementById("gps-history") ||
            document.getElementById("history");
        if (!historyElement) return;

        historyElement.replaceChildren();
        validPoints.slice().reverse().forEach(item => {
            const row = document.createElement("tr");
            const values = [
                item.recorded_at
                    ? new Date(item.recorded_at).toLocaleTimeString()
                    : "",
                `${Number(item.latitude).toFixed(6)}`,
                `${Number(item.longitude).toFixed(6)}`,
                `${Number(item.speed_kmph || 0).toFixed(1)}`
            ];

            values.forEach(value => {
                const cell = document.createElement("td");
                cell.textContent = value;
                row.appendChild(cell);
            });
            historyElement.appendChild(row);
        });

        if (validPoints.length === 0) {
            const row = document.createElement("tr");
            const cell = document.createElement("td");
            cell.colSpan = 4;
            cell.textContent = "No records yet";
            row.appendChild(cell);
            historyElement.appendChild(row);
        }
    } catch (error) {
        console.error("History loading failed:", error);
    }
}

async function checkServer() {
    try {
        const response = await fetch(API.health, { cache: "no-store" });
        updateText(
            ["server-status", "serverStatus", "server"],
            response.ok ? "Online" : "Offline"
        );
    } catch (error) {
        console.error("Server health check failed:", error);
        updateText(["server-status", "serverStatus", "server"], "Offline");
    }
}

function setupGeofenceForm() {
    const form = document.getElementById("form");
    const message = document.getElementById("msg");
    if (!form) return;

    form.addEventListener("submit", async event => {
        event.preventDefault();
        try {
            const response = await fetch(API.geofences, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: document.getElementById("name").value,
                    latitude: Number(document.getElementById("flat").value),
                    longitude: Number(document.getElementById("flon").value),
                    radius_m: Number(document.getElementById("radius").value)
                })
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || `Geofence API error (${response.status})`);
            }

            if (message) message.textContent = "Saved";
            await loadGeofences();
        } catch (error) {
            console.error("Geofence save failed:", error);
            if (message) message.textContent = error.message;
        }
    });

    const fenceList = document.getElementById("fences");
    if (fenceList) {
        fenceList.addEventListener("click", async event => {
            const button = event.target.closest("button[data-id]");
            if (!button) return;

            try {
                const response = await fetch(
                    `${API.geofences}/${encodeURIComponent(button.dataset.id)}`,
                    { method: "DELETE" }
                );
                if (!response.ok) {
                    throw new Error(`Geofence delete failed (${response.status})`);
                }
                await loadGeofences();
            } catch (error) {
                console.error("Geofence deletion failed:", error);
                if (message) message.textContent = error.message;
            }
        });
    }
}

async function startDashboard() {
    initializeMap();
    setupGeofenceForm();

    const refreshButton = document.getElementById("refresh");
    if (refreshButton) refreshButton.addEventListener("click", loadHistory);

    await Promise.all([checkServer(), loadLatestLocation(), loadHistory()]);

    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(async () => {
        await Promise.all([checkServer(), loadLatestLocation(), loadHistory()]);
    }, 3000);
}

document.addEventListener("DOMContentLoaded", startDashboard);
