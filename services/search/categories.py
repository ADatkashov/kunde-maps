"""Place categories derived from real OpenStreetMap tags, plus sanitizers for contact data.

One primary category per object, decided by the first matching rule below. Nothing here invents data: an object with no
matching tag has no category and is never offered as a place; contact fields that fail validation are dropped, not repaired.
"""
import re
from urllib.parse import urlsplit

# Order = UI order. Each category lists (osm_key, {values} or None for "any value").
CATEGORIES = {
    "restaurant": [("amenity", {"restaurant", "fast_food", "food_court", "biergarten", "bar", "pub", "nightclub"})],
    "cafe": [("amenity", {"cafe", "ice_cream"}), ("shop", {"bakery", "coffee", "tea", "confectionery", "pastry"})],
    "pharmacy": [("amenity", {"pharmacy"}), ("healthcare", {"pharmacy"}), ("shop", {"chemist"})],
    "hospital": [("amenity", {"hospital", "clinic", "doctors", "dentist", "veterinary"}), ("healthcare", None)],
    "shop": [("shop", None)],
    "school": [("amenity", {"school", "kindergarten", "college", "university", "language_school", "childcare"})],
    "fuel": [("amenity", {"fuel", "charging_station"})],
    "parking": [("amenity", {"parking", "parking_entrance"})],
    "bank": [("amenity", {"bank", "atm", "bureau_de_change"})],
    "hotel": [("tourism", {"hotel", "hostel", "guest_house", "motel", "apartment", "chalet", "resort"})],
    "beauty": [("shop", {"hairdresser", "beauty", "massage", "cosmetics", "tattoo"}), ("amenity", {"spa"}), ("leisure", {"sauna"})],
    "sport": [("leisure", {"fitness_centre", "sports_centre", "stadium", "swimming_pool", "pitch", "ice_rink", "golf_course", "sports_hall"})],
    "culture": [("amenity", {"cinema", "theatre", "arts_centre", "library", "planetarium"}),
                ("tourism", {"museum", "gallery", "attraction", "zoo", "theme_park", "viewpoint", "artwork"})],
    "park": [("leisure", {"park", "garden", "playground", "nature_reserve", "dog_park"})],
    "auto": [("amenity", {"car_wash", "car_rental", "car_sharing"}), ("shop", {"car", "car_repair", "car_parts", "tyres"}), ("craft", {"car_repair"})],
    "transport": [("amenity", {"bus_station", "taxi", "ferry_terminal"}), ("railway", {"station", "halt"}),
                  ("public_transport", {"station"}), ("aeroway", {"terminal"})],
    "services": [("amenity", {"post_office", "police", "townhall", "courthouse", "fire_station", "public_building", "community_centre", "place_of_worship", "toilets"}),
                 ("office", {"government", "notary", "lawyer", "insurance", "telecommunication"})],
}
# "shop" would swallow beauty/auto/cafe shops, so more specific categories are evaluated first.
PRIORITY = ["pharmacy", "cafe", "beauty", "auto", "restaurant", "hospital", "school", "fuel", "parking", "bank", "hotel", "sport",
            "culture", "park", "transport", "services", "shop"]
CATEGORY_IDS = list(CATEGORIES)
# Objects without a name are still useful (and honest) for these: a lot of parking lots, ATMs and fuel stations carry no name.
NAMELESS_OK = {"parking", "fuel", "bank", "transport"}
# Tags that exist but mean "not a visitable place"
EXCLUDED = {("amenity", "parking_space"), ("amenity", "bench"), ("amenity", "waste_basket"), ("amenity", "shelter")}


def categorize(tags):
    """Return (category, subtype) or ('', '') for a dict of OSM tags."""
    for category in PRIORITY:
        for key, values in CATEGORIES[category]:
            value = tags.get(key)
            if not value or value in ("no", "none"):
                continue
            first = str(value).split(";")[0].strip()
            if (key, first) in EXCLUDED:
                continue
            if values is None or first in values:
                return category, first
    return "", ""


_PHONE_OK = re.compile(r"^[+0-9 ()\-.]{5,25}$")


def clean_phone(value):
    """Keep only plausible phone numbers (digits, +, spaces, brackets, dashes); 'a; b' lists keep valid parts, max 3."""
    out = []
    for part in re.split(r"[;,]", str(value or "")):
        part = part.strip()
        if _PHONE_OK.match(part) and sum(ch.isdigit() for ch in part) >= 5:
            out.append(part)
    return "; ".join(out[:3])


def clean_website(value):
    """Only absolute http(s) URLs with a host; no credentials; <= 300 chars. (Blocks javascript:/data: links.)"""
    text = str(value or "").strip().split(";")[0].strip()
    if text and "://" not in text and re.match(r"^(www\.)?[a-z0-9.-]+\.[a-z]{2,}(/.*)?$", text, re.I):
        text = "https://" + text
    if not text or len(text) > 300 or any(c.isspace() or ord(c) < 32 for c in text):
        return ""
    try:
        parts = urlsplit(text)
    except ValueError:
        return ""
    if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password or "." not in parts.hostname:
        return ""
    return text


def clean_hours(value):
    """opening_hours is shown verbatim (the web app interprets only simple patterns); drop control chars, cap length."""
    text = "".join(ch for ch in str(value or "") if ch >= " ").strip()
    return text[:250]


def address_from(tags):
    """Compose an address only from address tags that exist. Returns '' when there is nothing real to show."""
    street = str(tags.get("addr:street") or "").strip()
    number = str(tags.get("addr:housenumber") or "").strip()
    city = str(tags.get("addr:city") or "").strip()
    line = " ".join(part for part in (street, number) if part)
    return ", ".join(part for part in (line, city) if part)


def quality(name, address, phone, website, hours, brand):
    """0-7 completeness score used for ranking (real attributes only)."""
    return (2 if name else 0) + sum(1 for value in (address, phone, website, hours, brand) if value)
