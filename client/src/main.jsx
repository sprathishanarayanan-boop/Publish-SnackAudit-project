import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import './styles.css';
import { session } from './api';
import { AuthContext, navigate } from './ctx';
import EventsPage from './pages/EventsPage';
import EventPage from './pages/EventPage';
import CheckoutPage from './pages/CheckoutPage';
import OrdersPage from './pages/OrdersPage';
import AuthPage from './pages/AuthPage';
import DashboardPage from './pages/DashboardPage';
import EventEditorPage from './pages/EventEditorPage';
import EventManagePage from './pages/EventManagePage';
import AdminPage from './pages/AdminPage';


function useRoute() {
  const [hash, setHash] = useState(window.location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => { setHash(window.location.hash.slice(1) || '/'); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

const routes = [
  [/^\/$/, () => <EventsPage />],
  [/^\/events\/([\w-]+)$/, (m) => <EventPage id={m[1]} />],
  [/^\/checkout\/([\w-]+)$/, (m) => <CheckoutPage id={m[1]} />, ['attendee']],
  [/^\/orders$/, () => <OrdersPage />, ['attendee']],
  [/^\/login$/, () => <AuthPage mode="login" />],
  [/^\/register$/, () => <AuthPage mode="register" />],
  [/^\/organizer$/, () => <DashboardPage />, ['organizer', 'admin']],
  [/^\/organizer\/new$/, () => <EventEditorPage />, ['organizer']],
  [/^\/organizer\/events\/([\w-]+)$/, (m) => <EventManagePage id={m[1]} />, ['organizer', 'admin']],
  [/^\/admin$/, () => <AdminPage />, ['admin']],
];

function Nav({ user, logout }) {
  const links = [{ to: '/', label: 'Events' }];
  if (user?.role === 'attendee') links.push({ to: '/orders', label: 'My tickets' });
  if (user?.role === 'organizer') links.push({ to: '/organizer', label: 'Dashboard' }, { to: '/organizer/new', label: 'New event' });
  if (user?.role === 'admin') links.push({ to: '/admin', label: 'Admin' }, { to: '/organizer', label: 'Platform analytics' });
  const route = window.location.hash.slice(1) || '/';
  return (
    <header className="topbar">
      <a className="brand" href="#/">
        <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M4 8a2 2 0 0 1 2-2h20a2 2 0 0 1 2 2v4a4 4 0 0 0 0 8v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4a4 4 0 0 0 0-8z" fill="currentColor"/><path d="M19 6v20" stroke="var(--marigold)" strokeWidth="2" strokeDasharray="2 2"/></svg>
        TicketForge
      </a>
      <nav aria-label="Main">
        {links.map((l) => (
          <a key={l.to} href={`#${l.to}`} aria-current={route === l.to ? 'page' : undefined}>{l.label}</a>
        ))}
      </nav>
      <div className="who">
        {user ? (
          <>
            <span className="who-name">{user.name}<small>{user.role === 'organizer' ? user.organizationName : user.role}</small></span>
            <button className="btn ghost small" onClick={logout}>Log out</button>
          </>
        ) : (
          <>
            <a className="btn ghost small" href="#/login">Log in</a>
            <a className="btn small" href="#/register">Sign up</a>
          </>
        )}
      </div>
    </header>
  );
}

function App() {
  const [user, setUser] = useState(session.user);
  const route = useRoute();
  useEffect(() => {
    const on = () => setUser(null);
    window.addEventListener('tf:logout', on);
    return () => window.removeEventListener('tf:logout', on);
  }, []);
  const login = (token, u) => { session.save(token, u); setUser(u); };
  const logout = () => { session.clear(); setUser(null); navigate('/'); };

  let page = <div className="page"><h1>Page not found</h1><p><a href="#/">Browse events</a></p></div>;
  for (const [re, render, roles] of routes) {
    const m = route.match(re);
    if (!m) continue;
    if (roles && !user) page = <AuthPage mode="login" reason="Log in to continue." />;
    else if (roles && !roles.includes(user.role)) page = <div className="page"><h1>Not available for your account</h1><p>This page is for {roles.join(' or ')} accounts.</p></div>;
    else page = render(m);
    break;
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      <a className="skip" href="#main">Skip to content</a>
      <Nav user={user} logout={logout} />
      <main id="main">{page}</main>
      <footer className="foot">TicketForge is a demo project. Payments are simulated and no real money moves.</footer>
    </AuthContext.Provider>
  );
}

createRoot(document.getElementById('root')).render(<App />);
