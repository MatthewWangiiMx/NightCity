"""Scenario catalog for the What-if Lab."""

from app.schemas.models import Scenario, ScenarioKind

SCENARIOS: dict[ScenarioKind, Scenario] = {
    ScenarioKind.BASELINE: Scenario(
        id="baseline", kind=ScenarioKind.BASELINE, label="Baseline",
        description="No disruption, no coordinated response.",
    ),
    ScenarioKind.SOLAR_DROP: Scenario(
        id="solar_drop", kind=ScenarioKind.SOLAR_DROP, label="Solar Drop",
        description="Cloud cover cuts solar output 35% as evening demand rises.",
    ),
    ScenarioKind.HEAT_WAVE: Scenario(
        id="heat_wave", kind=ScenarioKind.HEAT_WAVE, label="Heat Wave",
        description="Sustained high ambient temperature drives HVAC load up.",
    ),
    ScenarioKind.EV_SURGE: Scenario(
        id="ev_surge", kind=ScenarioKind.EV_SURGE, label="EV Surge",
        description="Simultaneous evening EV plug-in across the district.",
    ),
    ScenarioKind.BATTERY_OUTAGE: Scenario(
        id="battery_outage", kind=ScenarioKind.BATTERY_OUTAGE, label="Battery Outage",
        description="Shared storage goes offline mid-event.",
    ),
    ScenarioKind.STORM: Scenario(
        id="storm", kind=ScenarioKind.STORM, label="Thunderstorm",
        description="A thunderstorm takes generation and lines out of service.",
    ),
}


def list_scenarios() -> list[Scenario]:
    return list(SCENARIOS.values())
