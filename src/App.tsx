import { BrowserRouter, Routes, Route } from 'react-router-dom'
import GMView from './components/GMView'
import ObserverViewPage from './components/ObserverViewPage'
import PlayerView from './components/PlayerView'
import CampaignSelection from './components/CampaignSelection'
import ScenarioSelection from './components/ScenarioSelection'
import './App.css'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CampaignSelection />} />
        <Route path="/campaign/:campaignName" element={<ScenarioSelection />} />
        <Route path="/campaign/:campaignName/:scenarioName/gm" element={<GMView />} />
        <Route path="/:session/observer" element={<ObserverViewPage />} />
        <Route path="/:session/player" element={<PlayerView />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
