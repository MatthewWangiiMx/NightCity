import { Route, Routes } from 'react-router-dom';
import AppShell from '@/components/AppShell';
import Home from '@/pages/Home';
import Explore from '@/pages/Explore';
import Simulate from '@/pages/Simulate';
import Plan from '@/pages/Plan';
import BuildingDetail from '@/pages/BuildingDetail';

export default function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/explore" element={<Explore />} />
        <Route path="/simulate" element={<Simulate />} />
        <Route path="/plan" element={<Plan />} />
        <Route path="/building/:buildingId" element={<BuildingDetail />} />
      </Routes>
    </AppShell>
  );
}
