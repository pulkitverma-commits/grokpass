import type { Playbook } from '@/lib/content/use-cases';
import Icon from '../components/Icon';

export default function PlaybookCard({ p }: { p: Playbook }) {
  return (
    <article className="playbook" id={p.id}>
      <h3>{p.title}</h3>
      <p className="playbook-when"><strong>When:</strong> {p.when}</p>
      <ol className="step-list compact">
        {p.steps.map((s, i) => <li key={i}><span className="step-num">{i + 1}</span><span>{s}</span></li>)}
      </ol>
      <div className="playbook-settings">
        <span>Settings</span>
        {p.settings.map(s => <code key={s}><Icon name="check" size={12} strokeWidth={2.6} />{s}</code>)}
      </div>
    </article>
  );
}
