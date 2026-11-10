// Join by pasting an invite link (from Welcome or the Chats screen). The deep-link entry is
// app/chat/join.tsx, which reads the token from the URL that opened the app.
import { JoinScreen } from '../components/JoinScreen';

export default function JoinRoute() {
  return <JoinScreen initialToken={null} />;
}
