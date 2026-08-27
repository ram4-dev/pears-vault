import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, Easing, interpolate, Sequence, useCurrentFrame } from 'remotion'

const palette = {
  bg: '#06100c',
  bgRaised: '#0a1812',
  panel: '#0d1d16',
  panelStrong: '#11271d',
  line: '#29533f',
  green: '#67f5a8',
  greenSoft: '#b0ffd1',
  cyan: '#75d8ff',
  amber: '#ffd166',
  text: '#effff5',
  muted: '#86ad99',
  danger: '#ff7b8a'
}

const mono: CSSProperties = {
  fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace'
}

const ease = Easing.bezier(0.16, 1, 0.3, 1)

const SceneFrame = ({
  duration,
  step,
  title,
  children
}: {
  duration: number
  step: string
  title: string
  children: ReactNode
}) => {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill
      style={{
        backgroundColor: palette.bg,
        backgroundImage:
          'linear-gradient(rgba(103,245,168,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(103,245,168,0.035) 1px, transparent 1px)',
        backgroundSize: '36px 36px',
        color: palette.text,
        fontFamily: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
        opacity: interpolate(frame, [0, 15, duration - 15, duration], [0, 1, 1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp'
        })
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(circle at 78% 18%, rgba(35,101,72,0.42) 0, transparent 40%)'
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 34,
          left: 58,
          right: 58,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
          <div
            style={{
              width: 38,
              height: 38,
              display: 'grid',
              placeItems: 'center',
              border: `1px solid ${palette.green}`,
              borderRadius: 11,
              color: palette.green,
              fontSize: 20,
              boxShadow: '0 0 24px rgba(103,245,168,0.16)'
            }}
          >
            ◈
          </div>
          <div style={{ fontWeight: 850, fontSize: 24, letterSpacing: -0.5 }}>Hackvault</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <span
            style={{
              ...mono,
              color: palette.green,
              border: `1px solid ${palette.line}`,
              background: 'rgba(8,22,16,0.8)',
              borderRadius: 999,
              padding: '7px 12px',
              fontSize: 14
            }}
          >
            {step}
          </span>
          <span style={{ color: palette.muted, fontSize: 17, fontWeight: 700 }}>{title}</span>
        </div>
      </div>
      {children}
    </AbsoluteFill>
  )
}

const Window = ({
  title,
  children,
  style
}: {
  title: string
  children: ReactNode
  style?: CSSProperties
}) => (
  <div
    style={{
      border: `1px solid ${palette.line}`,
      borderRadius: 18,
      overflow: 'hidden',
      background: 'rgba(7,20,14,0.96)',
      boxShadow: '0 28px 80px rgba(0,0,0,0.32)',
      ...style
    }}
  >
    <div
      style={{
        height: 48,
        display: 'flex',
        alignItems: 'center',
        borderBottom: `1px solid ${palette.line}`,
        background: '#0b1813',
        padding: '0 16px'
      }}
    >
      <div style={{ display: 'flex', gap: 8 }}>
        {[palette.danger, palette.amber, palette.green].map(color => (
          <span key={color} style={{ width: 10, height: 10, borderRadius: 99, background: color, opacity: 0.9 }} />
        ))}
      </div>
      <span style={{ ...mono, marginLeft: 14, color: palette.muted, fontSize: 14 }}>{title}</span>
    </div>
    {children}
  </div>
)

const TerminalLine = ({
  frame,
  start,
  children,
  prompt = false,
  color = palette.text
}: {
  frame: number
  start: number
  children: ReactNode
  prompt?: boolean
  color?: string
}) => (
  <div
    style={{
      ...mono,
      display: 'flex',
      gap: 11,
      minHeight: 31,
      alignItems: 'center',
      color,
      fontSize: 21,
      opacity: interpolate(frame, [start, start + 12], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: ease
      }),
      translate: interpolate(frame, [start, start + 12], ['0px 10px', '0px 0px'], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: ease
      })
    }}
  >
    <span style={{ width: 16, color: palette.green }}>{prompt ? '❯' : ''}</span>
    <span>{children}</span>
  </div>
)

const ServerIcon = ({ active = false }: { active?: boolean }) => (
  <div
    style={{
      width: 130,
      height: 154,
      borderRadius: 20,
      border: `1px solid ${active ? palette.green : palette.line}`,
      background: `linear-gradient(155deg, ${palette.panelStrong}, ${palette.panel})`,
      padding: 18,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      boxShadow: active ? '0 0 44px rgba(103,245,168,0.22)' : '0 18px 50px rgba(0,0,0,0.3)'
    }}
  >
    {[0, 1, 2].map(row => (
      <div
        key={row}
        style={{
          flex: 1,
          border: `1px solid ${palette.line}`,
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 10px',
          background: '#091710'
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: 99, background: active ? palette.green : palette.muted }} />
        <span style={{ width: 48, height: 3, borderRadius: 99, background: palette.line }} />
      </div>
    ))}
  </div>
)

const VaultIcon = ({ frame = 0, activeAt = 0, size = 150 }: { frame?: number; activeAt?: number; size?: number }) => (
  <div
    style={{
      width: size,
      height: size,
      display: 'grid',
      placeItems: 'center',
      position: 'relative',
      filter: `drop-shadow(0 0 ${interpolate(frame, [activeAt, activeAt + 28], [10, 34], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp'
      })}px rgba(103,245,168,0.42))`,
      scale: interpolate(frame, [activeAt, activeAt + 16, activeAt + 28], [0.94, 1.06, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: ease
      })
    }}
  >
    <div
      style={{
        position: 'absolute',
        inset: 0,
        clipPath: 'polygon(50% 0%, 91% 18%, 84% 72%, 50% 100%, 16% 72%, 9% 18%)',
        background: `linear-gradient(145deg, ${palette.green}, #1f8d5a)`
      }}
    />
    <div
      style={{
        position: 'absolute',
        inset: 5,
        clipPath: 'polygon(50% 0%, 91% 18%, 84% 72%, 50% 100%, 16% 72%, 9% 18%)',
        background: palette.bgRaised
      }}
    />
    <div style={{ position: 'relative', width: size * 0.32, height: size * 0.3 }}>
      <div
        style={{
          position: 'absolute',
          left: '20%',
          right: '20%',
          top: 0,
          height: '48%',
          border: `${Math.max(3, size * 0.035)}px solid ${palette.green}`,
          borderBottom: 0,
          borderRadius: '20px 20px 0 0'
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: '38% 0 0',
          borderRadius: 8,
          background: palette.green,
          display: 'grid',
          placeItems: 'center',
          color: palette.bg,
          fontWeight: 900,
          fontSize: size * 0.14
        }}
      >
        •
      </div>
    </div>
  </div>
)

const FileIcon = ({ color = palette.green }: { color?: string }) => (
  <div
    style={{
      width: 42,
      height: 52,
      border: `2px solid ${color}`,
      borderRadius: 7,
      position: 'relative',
      background: 'rgba(103,245,168,0.04)'
    }}
  >
    <div style={{ position: 'absolute', left: 9, right: 9, top: 17, height: 2, background: color, opacity: 0.8 }} />
    <div style={{ position: 'absolute', left: 9, right: 14, top: 26, height: 2, background: color, opacity: 0.6 }} />
    <div style={{ position: 'absolute', left: 9, right: 18, top: 35, height: 2, background: color, opacity: 0.4 }} />
  </div>
)

const Laptop = ({ children, accent = palette.green }: { children?: ReactNode; accent?: string }) => (
  <div style={{ width: 300 }}>
    <div
      style={{
        height: 170,
        border: `2px solid ${accent}`,
        borderRadius: '14px 14px 7px 7px',
        background: '#07140e',
        boxShadow: `0 0 34px ${accent}22`,
        overflow: 'hidden'
      }}
    >
      {children}
    </div>
    <div
      style={{
        height: 12,
        margin: '0 -17px',
        borderRadius: '0 0 18px 18px',
        background: `linear-gradient(90deg, ${palette.line}, ${accent}, ${palette.line})`
      }}
    />
  </div>
)

const SceneLabel = ({ frame, start, children }: { frame: number; start: number; children: ReactNode }) => (
  <div
    style={{
      position: 'absolute',
      left: '50%',
      bottom: 34,
      translate: '-50% 0px',
      border: `1px solid ${palette.line}`,
      background: 'rgba(8,22,16,0.92)',
      color: palette.greenSoft,
      borderRadius: 999,
      padding: '11px 20px',
      fontSize: 20,
      fontWeight: 800,
      whiteSpace: 'nowrap',
      opacity: interpolate(frame, [start, start + 16], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp'
      }),
      scale: interpolate(frame, [start, start + 16], [0.9, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: ease
      })
    }}
  >
    {children}
  </div>
)

const HostScene = () => {
  const frame = useCurrentFrame()
  return (
    <SceneFrame duration={120} step="01" title="START THE HOST">
      <div style={{ position: 'absolute', left: 76, top: 156, width: 220, display: 'grid', justifyItems: 'center', gap: 14 }}>
        <ServerIcon active={frame >= 68} />
        <div style={{ color: palette.green, fontWeight: 850, fontSize: 18 }}>HOST / BOSS MACHINE</div>
        <div style={{ color: palette.muted, fontSize: 15 }}>Canonical writer</div>
      </div>
      <Window
        title="host — ~/project"
        style={{
          position: 'absolute',
          left: 342,
          right: 66,
          top: 140,
          height: 430,
          opacity: interpolate(frame, [5, 22], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          translate: interpolate(frame, [5, 22], ['26px 0px', '0px 0px'], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: ease
          })
        }}
      >
        <div style={{ padding: '28px 26px' }}>
          <TerminalLine frame={frame} start={18} prompt>
            hackvault host start
          </TerminalLine>
          <div style={{ height: 12 }} />
          <TerminalLine frame={frame} start={48} color={palette.muted}>
            Starting vault storage and announcing on HyperDHT…
          </TerminalLine>
          <TerminalLine frame={frame} start={66} color={palette.greenSoft}>
            HACKVAULT_PUBLIC_KEY=<span style={{ color: palette.cyan }}>a8f2…91ce</span>
          </TerminalLine>
          <TerminalLine frame={frame} start={82} color={palette.green}>
            Host is serving encrypted vault replication.
          </TerminalLine>
        </div>
      </Window>
      <div
        style={{
          position: 'absolute',
          right: 92,
          top: 100,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          border: `1px solid ${palette.green}`,
          borderRadius: 999,
          padding: '10px 16px',
          background: '#0a1b13',
          color: palette.greenSoft,
          fontSize: 17,
          fontWeight: 800,
          boxShadow: '0 0 30px rgba(103,245,168,0.2)',
          opacity: interpolate(frame, [76, 92], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          scale: interpolate(frame, [76, 92], [0.85, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: ease
          })
        }}
      >
        <span style={{ width: 9, height: 9, borderRadius: 99, background: palette.green }} />
        Host online — serving vault
      </div>
    </SceneFrame>
  )
}

const EditEnvScene = () => {
  const frame = useCurrentFrame()
  const typedCount = Math.floor(
    interpolate(frame, [70, 126], [0, 'new-secret'.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  )
  const apiValue = frame < 66 ? 'old-value' : 'new-secret'.slice(0, typedCount)
  return (
    <SceneFrame duration={180} step="02" title="EDIT .env DIRECTLY">
      <div style={{ position: 'absolute', left: 64, top: 126, display: 'flex', alignItems: 'center', gap: 15 }}>
        <ServerIcon active />
        <div>
          <div style={{ color: palette.green, fontWeight: 850, fontSize: 17 }}>HOST MACHINE</div>
          <div style={{ color: palette.muted, fontSize: 14, marginTop: 5 }}>Watcher active</div>
        </div>
      </div>
      <Window title="editor — .env" style={{ position: 'absolute', left: 64, top: 332, width: 680, height: 250 }}>
        <div style={{ ...mono, padding: '25px 24px', fontSize: 21, lineHeight: 1.75 }}>
          <div><span style={{ color: palette.muted }}>1</span>  <span style={{ color: palette.cyan }}>DATABASE_URL</span>=postgres://…</div>
          <div
            style={{
              background: frame >= 50 && frame < 70 ? 'rgba(255,209,102,0.16)' : 'transparent',
              margin: '0 -10px',
              padding: '0 10px',
              borderRadius: 6
            }}
          >
            <span style={{ color: palette.muted }}>2</span>  <span style={{ color: palette.cyan }}>API_KEY</span>=
            <span style={{ color: frame < 66 ? palette.amber : palette.greenSoft }}>{apiValue}</span>
            <span style={{ color: palette.green, opacity: Math.floor(frame / 8) % 2 === 0 ? 1 : 0 }}>▌</span>
          </div>
        </div>
      </Window>

      <div style={{ position: 'absolute', right: 110, top: 188, display: 'grid', justifyItems: 'center', gap: 16 }}>
        <VaultIcon frame={frame} activeAt={130} size={172} />
        <div style={{ color: palette.green, fontWeight: 900, fontSize: 20 }}>ENCRYPTED VAULT</div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 685,
          top: 285,
          width: interpolate(frame, [122, 157], [0, 290], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: ease
          }),
          height: 4,
          borderRadius: 99,
          background: `linear-gradient(90deg, ${palette.green}, ${palette.cyan})`,
          boxShadow: `0 0 18px ${palette.green}`
        }}
      />
      {[0, 1, 2].map(index => (
        <span
          key={index}
          style={{
            position: 'absolute',
            left: interpolate(frame, [126 + index * 5, 162 + index * 5], [690, 960], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp'
            }),
            top: 277,
            width: 18,
            height: 18,
            borderRadius: 99,
            background: palette.green,
            opacity: interpolate(frame, [120 + index * 5, 132 + index * 5, 165 + index * 5], [0, 1, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp'
            })
          }}
        />
      ))}
      <div
        style={{
          position: 'absolute',
          left: 602,
          top: 234,
          display: 'flex',
          gap: 9,
          alignItems: 'center',
          color: palette.greenSoft,
          fontSize: 15,
          fontWeight: 800,
          opacity: interpolate(frame, [118, 136], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
        }}
      >
        <FileIcon /> watcher detected change
      </div>
      <SceneLabel frame={frame} start={136}>Edited .env → synced to vault</SceneLabel>
    </SceneFrame>
  )
}

const ConnectingPeersScene = () => {
  const frame = useCurrentFrame()
  return (
    <SceneFrame duration={150} step="03" title="CONNECT PEERS">
      <div style={{ position: 'absolute', left: '50%', top: 205, translate: '-50% 0px', display: 'grid', justifyItems: 'center', gap: 14 }}>
        <VaultIcon frame={frame} activeAt={74} size={170} />
        <div style={{ color: palette.green, fontSize: 18, fontWeight: 900 }}>VAULT</div>
        <div style={{ ...mono, color: palette.cyan, fontSize: 15 }}>a8f2…91ce</div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 74,
          top: 204,
          opacity: interpolate(frame, [12, 28], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          translate: interpolate(frame, [12, 28], ['-44px 0px', '0px 0px'], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: ease
          })
        }}
      >
        <Laptop accent={palette.cyan}>
          <div style={{ ...mono, padding: '24px 16px', fontSize: 16, color: palette.text, lineHeight: 1.6 }}>
            <div style={{ color: palette.muted }}>peer-01 ~</div>
            <div><span style={{ color: palette.green }}>❯</span> hackvault join</div>
            <div style={{ color: palette.cyan }}>  a8f2…91ce</div>
            <div style={{ color: palette.green, opacity: interpolate(frame, [50, 68], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>✓ connected</div>
          </div>
        </Laptop>
        <div style={{ textAlign: 'center', color: palette.cyan, marginTop: 14, fontWeight: 850 }}>PEER 01</div>
      </div>

      <div
        style={{
          position: 'absolute',
          right: 74,
          top: 204,
          opacity: interpolate(frame, [36, 52], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          translate: interpolate(frame, [36, 52], ['44px 0px', '0px 0px'], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: ease
          })
        }}
      >
        <Laptop>
          <div style={{ ...mono, padding: '24px 16px', fontSize: 16, color: palette.text, lineHeight: 1.6 }}>
            <div style={{ color: palette.muted }}>peer-02 ~</div>
            <div><span style={{ color: palette.green }}>❯</span> hackvault join</div>
            <div style={{ color: palette.cyan }}>  a8f2…91ce</div>
            <div style={{ color: palette.green, opacity: interpolate(frame, [72, 90], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>✓ connected</div>
          </div>
        </Laptop>
        <div style={{ textAlign: 'center', color: palette.green, marginTop: 14, fontWeight: 850 }}>PEER 02</div>
      </div>

      <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} width="1280" height="720" viewBox="0 0 1280 720">
        <path
          d="M374 300 C455 224 515 245 566 289"
          fill="none"
          stroke={palette.cyan}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="10 10"
          strokeDashoffset={-frame * 1.3}
          pathLength="1"
          style={{
            opacity: interpolate(frame, [44, 62], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
            strokeDasharray: `${interpolate(frame, [44, 70], [0.02, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} 1`
          }}
        />
        <path
          d="M906 300 C825 224 765 245 714 289"
          fill="none"
          stroke={palette.green}
          strokeWidth="4"
          strokeLinecap="round"
          pathLength="1"
          style={{
            opacity: interpolate(frame, [66, 84], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
            strokeDasharray: `${interpolate(frame, [66, 94], [0.02, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} 1`
          }}
        />
      </svg>
      <SceneLabel frame={frame} start={92}>Peers join with the public key</SceneLabel>
    </SceneFrame>
  )
}

const PeerEnvCard = ({ frame, start, peer, accent }: { frame: number; start: number; peer: string; accent: string }) => {
  const typedCount = Math.floor(
    interpolate(frame, [start, start + 35], [0, 'new-secret'.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  )
  return (
    <div
      style={{
        width: 430,
        border: `1px solid ${frame >= start ? accent : palette.line}`,
        borderRadius: 18,
        overflow: 'hidden',
        background: '#091710',
        boxShadow: frame >= start ? `0 0 36px ${accent}28` : '0 20px 60px rgba(0,0,0,0.3)'
      }}
    >
      <div
        style={{
          height: 52,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid ${palette.line}`,
          padding: '0 17px',
          background: palette.panel
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <FileIcon color={accent} />
          <span style={{ ...mono, color: palette.text, fontWeight: 750, fontSize: 16 }}>{peer}/.env</span>
        </div>
        <span
          style={{
            color: accent,
            fontSize: 13,
            fontWeight: 900,
            opacity: interpolate(frame, [start, start + 14], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp'
            })
          }}
        >
          LIVE UPDATED
        </span>
      </div>
      <div style={{ ...mono, padding: '24px 20px 28px', fontSize: 20, lineHeight: 1.7 }}>
        <div><span style={{ color: palette.cyan }}>DATABASE_URL</span>=postgres://…</div>
        <div>
          <span style={{ color: palette.cyan }}>API_KEY</span>=
          <span style={{ color: frame >= start ? palette.greenSoft : palette.amber }}>
            {frame < start ? 'old-value' : 'new-secret'.slice(0, typedCount)}
          </span>
          <span style={{ color: accent, opacity: frame >= start && Math.floor(frame / 7) % 2 === 0 ? 1 : 0 }}>▌</span>
        </div>
      </div>
    </div>
  )
}

const LiveUpdateScene = () => {
  const frame = useCurrentFrame()
  return (
    <SceneFrame duration={180} step="04" title="LIVE .env UPDATE">
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: 105,
          translate: '-50% 0px',
          display: 'grid',
          justifyItems: 'center',
          zIndex: 2
        }}
      >
        <VaultIcon frame={frame} activeAt={40} size={128} />
        <div
          style={{
            color: palette.green,
            fontSize: 15,
            fontWeight: 900,
            marginTop: 7,
            padding: '3px 10px',
            borderRadius: 999,
            background: palette.bg
          }}
        >
          CANONICAL VAULT
        </div>
      </div>

      <svg style={{ position: 'absolute', inset: 0 }} width="1280" height="720" viewBox="0 0 1280 720">
        <path
          d="M620 232 C560 286 420 276 292 340"
          fill="none"
          stroke={palette.cyan}
          strokeWidth="4"
          pathLength="1"
          style={{
            opacity: interpolate(frame, [35, 48], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
            strokeDasharray: `${interpolate(frame, [35, 72], [0.01, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} 1`
          }}
        />
        <path
          d="M660 232 C720 286 860 276 988 340"
          fill="none"
          stroke={palette.green}
          strokeWidth="4"
          pathLength="1"
          style={{
            opacity: interpolate(frame, [45, 58], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
            strokeDasharray: `${interpolate(frame, [45, 82], [0.01, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} 1`
          }}
        />
      </svg>

      <div
        style={{
          position: 'absolute',
          left: 80,
          top: 350,
          opacity: interpolate(frame, [10, 25], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          translate: interpolate(frame, [10, 25], ['-28px 0px', '0px 0px'], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: ease
          })
        }}
      >
        <PeerEnvCard frame={frame} start={72} peer="peer-01" accent={palette.cyan} />
      </div>
      <div
        style={{
          position: 'absolute',
          right: 80,
          top: 350,
          opacity: interpolate(frame, [18, 33], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          translate: interpolate(frame, [18, 33], ['28px 0px', '0px 0px'], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: ease
          })
        }}
      >
        <PeerEnvCard frame={frame} start={82} peer="peer-02" accent={palette.green} />
      </div>
      <SceneLabel frame={frame} start={120}>Vault change → every peer's .env updated live</SceneLabel>
    </SceneFrame>
  )
}

const EndCard = () => {
  const frame = useCurrentFrame()
  return (
    <SceneFrame duration={90} step="05" title="INSTALL HACKVAULT">
      <div
        style={{
          position: 'absolute',
          inset: '115px 70px 60px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          border: `1px solid ${palette.line}`,
          borderRadius: 28,
          background: 'radial-gradient(circle at center, rgba(31,141,90,0.18), rgba(8,22,16,0.92) 65%)',
          opacity: interpolate(frame, [5, 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
          scale: interpolate(frame, [5, 20], [0.96, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: ease
          })
        }}
      >
        <div style={{ color: palette.green, fontSize: 66, fontWeight: 900, letterSpacing: -2 }}>Hackvault</div>
        <div style={{ color: palette.text, fontSize: 25, marginTop: 10 }}>Encrypted secrets. Synced where you build.</div>
        <div style={{ ...mono, color: palette.cyan, fontSize: 21, marginTop: 28 }}>github.com/ram4-dev/pears-vault</div>
        <div
          style={{
            ...mono,
            marginTop: 34,
            width: 1010,
            border: `1px solid ${palette.line}`,
            borderRadius: 15,
            background: '#06110c',
            padding: '20px 24px',
            color: palette.greenSoft,
            fontSize: 18,
            opacity: interpolate(frame, [28, 44], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
            translate: interpolate(frame, [28, 44], ['0px 12px', '0px 0px'], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
              easing: ease
            }),
            whiteSpace: 'nowrap'
          }}
        >
          <span style={{ color: palette.green }}>❯</span> curl -fsSL https://raw.githubusercontent.com/ram4-dev/pears-vault/main/scripts/install.sh | bash
        </div>
      </div>
    </SceneFrame>
  )
}

export const HackvaultDemo = () => (
  <AbsoluteFill style={{ background: palette.bg }}>
    <Sequence name="Start the host" from={0} durationInFrames={120}>
      <HostScene />
    </Sequence>
    <Sequence name="Edit env and push to vault" from={120} durationInFrames={180}>
      <EditEnvScene />
    </Sequence>
    <Sequence name="Connect peers" from={300} durationInFrames={150}>
      <ConnectingPeersScene />
    </Sequence>
    <Sequence name="Update peer env files" from={450} durationInFrames={180}>
      <LiveUpdateScene />
    </Sequence>
    <Sequence name="End card" from={630} durationInFrames={90}>
      <EndCard />
    </Sequence>
  </AbsoluteFill>
)
