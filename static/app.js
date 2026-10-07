const paletteFallback = ["#167d78", "#d96843", "#5477b8", "#bc8b22", "#8b65a9", "#4f8b57", "#d05a7c", "#65717e"];
const state = { places: [], labels: [], palette: paletteFallback, office: null, markers: new Map(), draftMarker: null, addMode: false, pendingMove: null, activeId: null, selectedColor: paletteFallback[0] };
const $ = (selector) => document.querySelector(selector);
const map = L.map("map", { zoomControl: false, preferCanvas: true }).setView([50.835, 4.36], 12);
L.control.zoom({ position: "bottomright" }).addTo(map);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

function markerIcon(color, office = false, draft = false) {
  const classes = `marker-pin${office ? " office" : ""}${draft ? " draft" : ""}`;
  return L.divIcon({ className: "custom-marker", html: `<div class="${classes}" style="--marker-color:${color}"></div>`, iconSize: [28, 34], iconAnchor: [14, 30], popupAnchor: [0, -28] });
}
function showToast(message) {
  const toast = $("#toast"); toast.textContent = message; toast.classList.add("visible");
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("visible"), 2500);
}
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  if (!response.ok) {
    let message = "Something went wrong. Please try again.";
    try { message = (await response.json()).error || message; } catch { /* Empty response. */ }
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function distanceKm(lat, lon) {
  const rad = (degrees) => degrees * Math.PI / 180;
  const dLat = rad(lat - state.office.latitude), dLon = rad(lon - state.office.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(state.office.latitude)) * Math.cos(rad(lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function popup(place) {
  const distance = distanceKm(place.latitude, place.longitude).toFixed(1);
  const contact = place.contact_person ? `<span>${escapeHtml(place.contact_person)}</span>` : "";
  const link = place.link ? `<a href="${escapeHtml(place.link)}" target="_blank" rel="noopener noreferrer">Open link ↗</a>` : "";
  return `<div class="popup-content"><strong>${escapeHtml(place.name)}</strong><span>${escapeHtml(place.address)}</span><span>${escapeHtml(place.label)}</span>${contact}${link}<small>${distance} km straight-line distance to office</small><button class="popup-edit" type="button" data-edit-place="${place.id}">Edit place</button></div>`;
}
function renderMap() {
  for (const marker of state.markers.values()) map.removeLayer(marker);
  state.markers.clear();
  if (state.office) {
    const marker = L.marker([state.office.latitude, state.office.longitude], { icon: markerIcon("#283532", true), zIndexOffset: 1000 })
      .bindPopup(`<div class="popup-content"><strong>Office</strong><span>${escapeHtml(state.office.address)}</span></div>`).addTo(map);
    state.markers.set("office", marker);
  }
  for (const place of state.places) {
    const marker = L.marker([place.latitude, place.longitude], { icon: markerIcon(place.color) })
      .bindPopup(popup(place)).addTo(map);
    marker.on("click", () => { state.activeId = place.id; renderList(); });
    state.markers.set(place.id, marker);
  }
}
function renderList() {
  const filter = $("#filter-label").value;
  const places = state.places.filter((place) => !filter || String(place.label_id) === filter);
  $("#place-count").textContent = `${places.length} ${places.length === 1 ? "place" : "places"}`;
  $("#empty-state").hidden = places.length > 0;
  $("#place-list").innerHTML = places.map((place) => {
    const distance = distanceKm(place.latitude, place.longitude).toFixed(1);
    return `<div class="place-row${state.activeId === place.id ? " active" : ""}" style="--row-color:${place.color}">
      <button type="button" class="place-row-main" data-place-id="${place.id}"><span class="place-dot"></span><span class="place-copy"><strong>${escapeHtml(place.name)}</strong><small>${escapeHtml(place.address)}</small><span class="place-label">${escapeHtml(place.label)}</span></span><span class="place-distance">${distance} km</span></button>
      <button type="button" class="place-row-edit" data-edit-place="${place.id}">Edit</button></div>`;
  }).join("");
  $("#place-list").querySelectorAll("[data-place-id]").forEach((row) => row.addEventListener("click", () => {
    const place = state.places.find((item) => item.id === Number(row.dataset.placeId));
    state.activeId = place.id; renderList(); map.flyTo([place.latitude, place.longitude], Math.max(map.getZoom(), 15), { duration: .45 });
    state.markers.get(place.id)?.openPopup();
  }));
  $("#place-list").querySelectorAll("[data-edit-place]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    const place = state.places.find((item) => item.id === Number(button.dataset.editPlace));
    if (place) openPlaceDialog(place);
  }));
}
function renderLabels() {
  const previousFilter = $("#filter-label").value;
  const selectedLabel = $("#place-label").value;
  $("#filter-label").innerHTML = '<option value="">All labels</option>' + state.labels.map((label) => `<option value="${label.id}">${escapeHtml(label.name)}</option>`).join("");
  if (state.labels.some((label) => String(label.id) === previousFilter)) $("#filter-label").value = previousFilter;
  $("#place-label").innerHTML = state.labels.map((label) => `<option value="${label.id}">${escapeHtml(label.name)}</option>`).join("");
  if (state.labels.some((label) => String(label.id) === selectedLabel)) $("#place-label").value = selectedLabel;
  $("#label-list").innerHTML = state.labels.map((label) => `<span class="legend-chip" style="--chip-color:${label.color}"><i></i>${escapeHtml(label.name)}</span>`).join("");
  $("#managed-label-list").innerHTML = state.labels.map((label) => {
    const inUse = state.places.some((place) => place.label_id === label.id);
    return `<div class="managed-label-row" style="--managed-color:${label.color}"><i></i><span>${escapeHtml(label.name)}</span>${inUse ? "<small>In use</small>" : `<button type="button" data-delete-label="${label.id}">Remove</button>`}</div>`;
  }).join("");
  $("#managed-label-list").querySelectorAll("[data-delete-label]").forEach((button) => button.addEventListener("click", () => deleteLabel(button.dataset.deleteLabel)));
  const current = state.labels.find((label) => label.id === Number($("#place-label").value));
  $("#selected-swatch").style.setProperty("--swatch-color", current?.color || state.palette[0]);
}
async function refresh() {
  [state.places, state.labels] = await Promise.all([api("/api/places"), api("/api/labels")]);
  renderLabels(); renderList(); renderMap();
}
function enableAddMode() {
  state.addMode = true; $("#mode-hint").hidden = false; $("#map-hint").hidden = false;
  $("#mode-hint").firstChild.textContent = state.pendingMove ? "Click the map to move this pin. " : "Click a spot on the map to place a pin. ";
  $("#map-hint").lastChild.textContent = state.pendingMove ? "Click the map to move this pin" : "Click the map to choose a location";
  $("#add-mode").textContent = "Cancel add"; $("#add-mode").classList.add("mode-active"); map.getContainer().classList.add("adding-place");
}
function disableAddMode() {
  state.addMode = false; $("#mode-hint").hidden = true; $("#map-hint").hidden = true;
  $("#add-mode").innerHTML = "<span aria-hidden=\"true\">+</span> Add place"; $("#add-mode").classList.remove("mode-active"); map.getContainer().classList.remove("adding-place");
}
function cancelPlacement() {
  const pending = state.pendingMove;
  state.pendingMove = null;
  disableAddMode();
  if (pending) openPlaceDialog(pending);
}
function openPlaceDialog(place = null) {
  const form = $("#place-form"); form.reset(); $("#place-error").hidden = true;
  $("#dialog-title").textContent = place ? "Edit place" : "Add a place";
  $("#dialog-eyebrow").textContent = place ? "YOUR SHORTLIST" : "NEW LOCATION";
  $("#save-place").textContent = place ? "Save changes" : "Save place";
  $("#delete-place").hidden = !place;
  $("#move-place").hidden = !place;
  form.elements.id.value = place?.id || "";
  form.elements.latitude.value = place?.latitude ?? "";
  form.elements.longitude.value = place?.longitude ?? "";
  $("#place-name").value = place?.name || "";
  $("#place-address").value = place?.address || "";
  $("#place-notes").value = place?.notes || "";
  $("#place-contact").value = place?.contact_person || "";
  $("#place-link").value = place?.link || "";
  if (place) $("#place-label").value = place.label_id;
  renderLabels();
  $("#place-dialog").showModal();
  setTimeout(() => $("#place-name").focus(), 50);
}
function selectSearchResult(result) {
  disableAddMode();
  state.draftMarker?.remove();
  state.draftMarker = L.marker([result.latitude, result.longitude], { icon: markerIcon(state.palette[0], false, true) }).addTo(map);
  map.flyTo([result.latitude, result.longitude], Math.max(map.getZoom(), 16), { duration: .45 });
  $("#search-results").hidden = true;
  openPlaceDialog({ name: result.name, address: result.address, latitude: result.latitude, longitude: result.longitude });
}
async function deletePlace() {
  const id = $("#place-form").elements.id.value;
  if (!id || !confirm("Delete this saved place?")) return;
  try { await api(`/api/places/${id}`, { method: "DELETE" }); $("#place-dialog").close(); state.activeId = null; await refresh(); showToast("Place deleted"); }
  catch (error) { $("#place-error").textContent = error.message; $("#place-error").hidden = false; }
}
async function deleteLabel(id) {
  try { await api(`/api/labels/${id}`, { method: "DELETE" }); await refresh(); $("#labels-dialog").close(); showToast("Label removed"); }
  catch (error) { showToast(error.message); }
}
function initColorPicker() {
  $("#color-picker").innerHTML = state.palette.map((color, index) => `<button class="color-choice" type="button" style="--choice-color:${color}" aria-label="Color ${index + 1}" aria-pressed="${index === 0}" data-color="${color}"></button>`).join("");
  $("#color-picker").querySelectorAll("[data-color]").forEach((button) => button.addEventListener("click", () => {
    state.selectedColor = button.dataset.color;
    $("#color-picker").querySelectorAll("[data-color]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
  }));
}

map.on("click", (event) => {
  if (!state.addMode) return;
  const { lat, lng } = event.latlng;
  state.draftMarker?.remove();
  state.draftMarker = L.marker([lat, lng], { icon: markerIcon(state.palette[0], false, true) }).addTo(map);
  disableAddMode();
  if (state.pendingMove) {
    const moved = { ...state.pendingMove, latitude: lat, longitude: lng };
    state.pendingMove = null;
    openPlaceDialog(moved);
    return;
  }
  const address = `${lat.toFixed(5)}, ${lng.toFixed(5)} (map pin)`;
  openPlaceDialog({ name: "", address, latitude: lat, longitude: lng });
});
$("#add-mode").addEventListener("click", () => state.addMode ? cancelPlacement() : enableAddMode());
$("#cancel-mode").addEventListener("click", cancelPlacement);
$("#filter-label").addEventListener("change", renderList);
$("#place-label").addEventListener("change", () => {
  const label = state.labels.find((item) => item.id === Number($("#place-label").value));
  $("#selected-swatch").style.setProperty("--swatch-color", label?.color || state.palette[0]);
});
$("#place-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget; const id = form.elements.id.value;
  const payload = Object.fromEntries(["name", "address", "latitude", "longitude", "notes", "label_id", "contact_person", "link"].map((key) => [key, form.elements[key].value]));
  try {
    const saved = await api(id ? `/api/places/${id}` : "/api/places", { method: id ? "PUT" : "POST", body: JSON.stringify(payload) });
    $("#place-dialog").close(); state.draftMarker?.remove(); state.draftMarker = null; state.pendingMove = null; state.activeId = saved.id;
    await refresh(); map.flyTo([saved.latitude, saved.longitude], Math.max(map.getZoom(), 15), { duration: .4 }); showToast(id ? "Place updated" : "Place saved");
  } catch (error) { $("#place-error").textContent = error.message; $("#place-error").hidden = false; }
});
$("#delete-place").addEventListener("click", deletePlace);
$("#move-place").addEventListener("click", () => {
  const form = $("#place-form");
  state.pendingMove = Object.fromEntries(["id", "name", "address", "latitude", "longitude", "notes", "label_id", "contact_person", "link"].map((key) => [key, form.elements[key].value]));
  state.pendingMove.id = Number(state.pendingMove.id);
  $("#place-dialog").close(); enableAddMode();
});
$("#search-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const query = $("#place-search").value.trim();
  if (query.length < 3) { showToast("Enter at least 3 characters"); return; }
  const results = $("#search-results"); results.hidden = false; results.innerHTML = '<div class="search-result"><strong>Searching…</strong></div>';
  try {
    const matches = await api(`/api/search?q=${encodeURIComponent(query)}`);
    results.innerHTML = matches.length ? matches.map((item, index) => `<button class="search-result" type="button" data-result="${index}"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.address)}</span></button>`).join("") : '<div class="search-result"><strong>No places found</strong><span>Try another name or address.</span></div>';
    results.querySelectorAll("[data-result]").forEach((button) => button.addEventListener("click", () => selectSearchResult(matches[Number(button.dataset.result)])));
  } catch (error) { results.innerHTML = `<div class="search-result"><strong>Search unavailable</strong><span>${escapeHtml(error.message)}</span></div>`; }
});
function openLabels() { $("#label-error").hidden = true; $("#labels-dialog").showModal(); }
$("#manage-labels").addEventListener("click", openLabels);
$("#manage-labels-small").addEventListener("click", openLabels);
$("#label-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const input = $("#new-label-name");
  try {
    const label = await api("/api/labels", { method: "POST", body: JSON.stringify({ name: input.value, color: state.selectedColor }) });
    input.value = ""; await refresh(); $("#place-label").value = label.id; renderLabels(); showToast("Label added");
  } catch (error) { $("#label-error").textContent = error.message; $("#label-error").hidden = false; }
});
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => document.getElementById(button.dataset.close).close()));
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-edit-place]");
  if (!button) return;
  event.preventDefault();
  const place = state.places.find((item) => item.id === Number(button.dataset.editPlace));
  if (place) openPlaceDialog(place);
}, true);
$("#place-dialog").addEventListener("close", () => { state.draftMarker?.remove(); state.draftMarker = null; });

(async function init() {
  try {
    const config = await api("/api/config"); state.office = config.office; state.palette = config.palette;
    initColorPicker(); await refresh();
    const officeMarker = state.markers.get("office");
    if (officeMarker) map.fitBounds(L.latLngBounds([[state.office.latitude, state.office.longitude], [50.835, 4.36]]).pad(.2));
    setTimeout(() => map.invalidateSize(), 0);
  } catch (error) { showToast(error.message); }
})();
window.addEventListener("resize", () => map.invalidateSize());
