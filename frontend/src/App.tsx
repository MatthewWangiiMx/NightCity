import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppShell from '@/components/AppShell';
import CityExperience from '@/pages/CityExperience';
import Home from '@/pages/Home';
import Explore from '@/pages/Explore';
import Simulate from '@/pages/Simulate';
import Plan from '@/pages/Plan';
import BuildingDetail from '@/pages/BuildingDetail';

function AppliedPlanRoute() {
  const location = useLocation();
  return location.state?.fromPlanApply ? <Simulate /> : <Navigate to="/plan" replace />;
}

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route element={<CityExperience />}>
          <Route index element={<Home />} />
          <Route path="explore" element={<Explore />} />
        </Route>
        <Route path="/simulate" element={<AppliedPlanRoute />} />
        <Route path="/plan" element={<Plan />} />
        <Route path="/building/:buildingId" element={<BuildingDetail />} />
      </Routes>
    </AppShell>
  );
}
