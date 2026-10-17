import { useParams } from 'react-router-dom';
import Panel from '@/components/Panel';
import Placeholder from '@/components/Placeholder';

/** WattWise zoom-in: loads, HVAC schedule, comfort bounds, anomalies. */
export default function BuildingDetail() {
  const { buildingId } = useParams();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title={`Building ${buildingId ?? ''}`} subtitle="Loads and HVAC schedule">
        <Placeholder label="Load breakdown + HVAC setpoints" height={240} />
      </Panel>
      <Panel title="Comfort & Anomalies" subtitle="Temperature bounds and detected waste">
        <Placeholder label="Comfort band chart + anomaly list" height={240} />
      </Panel>
    </div>
  );
}
