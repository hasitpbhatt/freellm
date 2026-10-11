import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './components/AppShell'
import Landing from './pages/Landing'
import Placeholder from './pages/Placeholder'
import Login from './pages/Login'
import Admin from './pages/Admin'
import Earn from './pages/Earn'
import Chat from './pages/Chat'
import Models from './pages/Models'
import Dashboard from './pages/Dashboard'
import Usage from './pages/Usage'
import VerifyEmail from './pages/VerifyEmail'
import ReferralLanding from './pages/ReferralLanding'
import Battle from './pages/Battle'
import Keys from './pages/Keys'
import ApiDocs from './pages/ApiDocs'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Landing />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/battle" element={<Battle />} />
          <Route path="/earn" element={<Earn />} />
          <Route path="/models" element={<Models />} />
          <Route path="/developers" element={<ApiDocs />} />
          <Route path="/usage" element={<Usage />} />
          <Route path="/keys" element={<Keys />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/r/:code" element={<ReferralLanding />} />
          <Route path="/register" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Placeholder title="Not found" milestone="—" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
