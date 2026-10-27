import { redirect } from 'next/navigation';

// OnePeek+ is now the Plus and Pro plans.
export default function PlusPage() {
  redirect('/pricing');
}
