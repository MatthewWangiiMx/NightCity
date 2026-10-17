"""The fictional district under test. Synthetic data, labeled as such."""

from app.schemas.models import Asset, AssetKind, District

NIGHT_CITY = District(
    id="nightcity",
    name="Night City District",
    assets=[
        Asset(id="solar_farm", name="Solar Farm", kind=AssetKind.SOLAR,
              capacity_mw=120, x=0.22, y=0.18),
        Asset(id="wind", name="Wind Turbines", kind=AssetKind.WIND,
              capacity_mw=85, x=0.78, y=0.12),
        Asset(id="city", name="City District", kind=AssetKind.BUILDING,
              capacity_mw=320, x=0.50, y=0.40),
        Asset(id="battery", name="Battery Storage", kind=AssetKind.BATTERY,
              capacity_mw=60, x=0.80, y=0.52),
        Asset(id="ev", name="EV Charging", kind=AssetKind.EV_CHARGING,
              capacity_mw=42, x=0.20, y=0.62),
        Asset(id="grid", name="Grid Tie", kind=AssetKind.GRID_TIE,
              capacity_mw=500, x=0.50, y=0.92),
    ],
)


def get_district(district_id: str) -> District:
    # TODO: load from TigerData once districts are seeded; one district for now.
    return NIGHT_CITY
