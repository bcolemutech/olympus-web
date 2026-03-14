function HelloWorld() {
  const [name, setName] = React.useState('World');

  return (
    <div style={{ maxWidth: '400px' }}>
      <h2
        style={{
          fontSize: '1.5rem',
          fontWeight: 700,
          background: 'linear-gradient(135deg, #ffd54f, #ffb74d)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          marginBottom: '1rem',
        }}
      >
        Hello, {name}!
      </h2>
      <label
        style={{
          display: 'block',
          fontSize: '0.75rem',
          color: '#9ca3af',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: '0.4rem',
        }}
      >
        Your name
      </label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Enter your name"
        style={{
          width: '100%',
          padding: '0.75rem 1rem',
          fontSize: '0.95rem',
          fontFamily: 'inherit',
          color: '#e0e0e0',
          background: 'rgba(255, 255, 255, 0.05)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '8px',
          outline: 'none',
        }}
      />
    </div>
  );
}

window.__JSX_APPLET__ = HelloWorld;
