import { Link } from 'react-router-dom'
import { Card, CardHeader } from '../components/ui'

export default function NotFound() {
  return (
    <Card className="mx-auto max-w-md">
      <CardHeader title="Page not found" />
      <div className="p-6 text-center text-[13px] text-muted">
        <p className="mb-4">The page you're looking for doesn't exist or has been moved.</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link to="/" className="btn-secondary">Go home</Link>
          <Link to="/chat" className="btn-secondary">Try Chat</Link>
          <Link to="/dashboard" className="btn-secondary">Dashboard</Link>
        </div>
      </div>
    </Card>
  )
}