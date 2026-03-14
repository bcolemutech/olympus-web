function Counter() {
  const [count, setCount] = React.useState(0);

  const buttonStyle = {
    padding: '0.6rem 1.5rem',
    fontSize: '1rem',
    fontWeight: 600,
    fontFamily: 'inherit',
    color: '#0a0e1a',
    background: 'linear-gradient(135deg, #ffd54f, #ffb74d)',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    letterSpacing: '0.05em',
  };

  const resetStyle = {
    ...buttonStyle,
    background: 'transparent',
    color: '#90a4ae',
    border: '1px solid rgba(255, 255, 255, 0.1)',
  };

  return (
    <div style={{ textAlign: 'center', maxWidth: '300px' }}>
      <div
        style={{
          fontSize: '4rem',
          fontWeight: 700,
          background: 'linear-gradient(135deg, #ffd54f, #ffb74d, #ff8a65)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          marginBottom: '1.5rem',
          lineHeight: 1.2,
        }}
      >
        {count}
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
        <button style={buttonStyle} onClick={() => setCount(count - 1)}>
          &minus;
        </button>
        <button style={resetStyle} onClick={() => setCount(0)}>
          Reset
        </button>
        <button style={buttonStyle} onClick={() => setCount(count + 1)}>
          +
        </button>
      </div>
    </div>
  );
}

window.__JSX_APPLET__ = Counter;
