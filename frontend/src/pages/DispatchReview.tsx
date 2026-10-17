import DispatchPlanPanel from '@/components/panels/DispatchPlanPanel';
import Panel from '@/components/Panel';
import Placeholder from '@/components/Placeholder';
import { useSimulation } from '@/hooks/useSimulation';

export default function DispatchReview() {
  const { result } = useSimulation();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <DispatchPlanPanel actions={result?.actions} explanation={result?.explanation} />
      <Panel title="Trade-offs" subtitle="What each action costs and protects">
        <Placeholder label="Action-by-action trade-off table" height={240} />
      </Panel>
    </div>
  );
}
