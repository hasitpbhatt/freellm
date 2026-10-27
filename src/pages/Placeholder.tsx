import { Card, CardHeader } from '../components/ui'

export default function Placeholder({ title, milestone }: { title: string; milestone: string }) {
  return (
    <Card>
      <CardHeader title={title} />
      <div className="p-6 text-[13px] text-muted">
        Wireframed and specced. Implementation lands in <span className="text-content">{milestone}</span>.
      </div>
    </Card>
  )
}
