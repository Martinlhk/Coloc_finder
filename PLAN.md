# Coloc Finder

## Goal

A personal, Docker-run Python web app for saving potential shared flats in Brussels, organizing them with one label each, and comparing their map locations with the office. Travel times will be checked separately in Google Maps.

## First version

- Use Flask, SQLite, and Docker Compose. Persist the database in a named Docker volume; a separate MySQL service is unnecessary for this single-user app.
- Show an OpenStreetMap-backed Leaflet map centered on Brussels, with an office marker at 480 Avenue Louise and saved place markers.
- Let the user search explicitly for an address or landmark, select a result, then enter a place name, one label, optional contact person, optional web link, and notes.
- Provide an Add place mode: click the map to choose coordinates, then enter the name, label, and notes before saving.
- Let the user edit place details from its map popup and move its pin by choosing another map location.
- Use reusable labels with a chosen color. Keep each place linked to exactly one label and use that label's color for its map pin and list marker.
- List, filter, edit, and delete saved places and manage labels. Show straight-line distance from the office as a geographic comparison, not travel time.
- Keep the interface responsive, keyboard accessible, and attribution visible for OpenStreetMap map data.

## Data

- `places`: name, address, latitude, longitude, notes, optional contact person and web link, and one required label reference.
- `labels`: unique name and color, shared by any number of places.
- `geocode_cache`: user search query and results, reducing repeated requests.
- Seed the office at 480 Avenue Louise, 1050 Brussels (50.8171126, 4.3720834).

## Later, if needed

Transit lines, stops, and routing are outside the first version. The user will compare travel times in Google Maps. Any future transit feature should use a suitable current data source and distinguish actual route estimates from proximity to stops.

## References

- [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/): the app uses user-submitted searches rather than autocomplete, identifies itself, and caches results.
- [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/): retain attribution and follow tile caching and usage rules.
- [Leaflet reference](https://leafletjs.com/reference): interactive map API.
