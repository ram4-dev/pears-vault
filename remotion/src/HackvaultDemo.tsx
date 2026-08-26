import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, Easing, interpolate, Sequence, useCurrentFrame } from 'remotion'

const colors = {
  background: '#07110d',
  panel: '#0c1b15',
  panelStrong: '#10251c',
  border: '#244c3a',
  green: '#67f5a8',
  greenSoft: '#a7f8ca',
  text: '#ecfff4',
  muted: '#8cb4a0',
  blue: '#75baff',
  yellow: '#ffd166'
}

const mono: CSSProperties = {
  fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace'
}

const TerminalLine = ({
  frame,
  start,
  children,
  tone = 'text',
  prompt = false
}: {
  frame: number
  start: number
  children: ReactNode
  tone?: 'text' | 'muted' | 'green' | 'blue' | 'yellow'
  prompt?: boolean
}) => (
  <div
    style={{
      display: 'flex',
      gap: 12,
      minHeight: 31,
      alignItems: 'center',
      opacity: interpolate(frame, [start, start + 12], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: Easing.bezier(0.16, 1, 0.3, 1)
      }),
      translate: interpolate(frame, [start, start + 12], ['0px 12px', '0px 0px'], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: Easing.bezier(0.16, 1, 0.3, 1)
      }),
      color: colors[tone],
      fontSize: 22,
      lineHeight: 1.35,
      whiteSpace: 'nowrap'
    }}
  >
    {prompt ? <span style={{ color: colors.green }}>❯</span> : <span style={{ width: 18 }} />}
    <span>{children}</span>
  </div>
)

const StatusPill = ({ frame, start, children }: { frame: number; start: number; children: ReactNode }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      border: `1px solid ${colors.border}`,
      background: '#0a1712',
      borderRadius: 999,
      padding: '9px 15px',
      color: colors.greenSoft,
      fontSize: 17,
      fontWeight: 650,
      opacity: interpolate(frame, [start, start + 14], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp'
      }),
      scale: interpolate(frame, [start, start + 14], [0.86, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: Easing.bezier(0.16, 1, 0.3, 1)
      })
    }}
  >
    <span
      style={{
        width: 9,
        height: 9,
        borderRadius: 99,
        background: colors.green,
        boxShadow: `0 0 14px ${colors.green}`
      }}
    />
    {children}
  </div>
)

const FlowArrow = ({ frame }: { frame: number }) => (
  <svg width="210" height="86" viewBox="0 0 210 86" style={{ overflow: 'visible' }}>
    <path
      d="M8 43 C60 4 145 4 196 38"
      fill="none"
      stroke={colors.green}
      strokeWidth="3"
      strokeLinecap="round"
      strokeDasharray="8 10"
      strokeDashoffset={-frame * 1.4}
      opacity={interpolate(frame, [285, 310], [0, 0.9], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp'
      })}
    />
    <path d="M184 29 L199 39 L182 44" fill="none" stroke={colors.green} strokeWidth="3" strokeLinecap="round" />
  </svg>
)

const EnvCard = ({ frame }: { frame: number }) => (
  <div
    style={{
      position: 'absolute',
      right: 68,
      top: 212,
      width: 344,
      border: `1px solid ${colors.border}`,
      borderRadius: 18,
      background: `linear-gradient(145deg, ${colors.panelStrong}, ${colors.panel})`,
      boxShadow: '0 24px 70px rgba(0,0,0,0.34)',
      overflow: 'hidden',
      opacity: interpolate(frame, [278, 305], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: Easing.bezier(0.16, 1, 0.3, 1)
      }),
      translate: interpolate(frame, [278, 305], ['46px 0px', '0px 0px'], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
        easing: Easing.bezier(0.16, 1, 0.3, 1)
      })
    }}
  >
    <div
      style={{
        height: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 18px',
        borderBottom: `1px solid ${colors.border}`,
        color: colors.text,
        fontWeight: 700,
        fontSize: 18
      }}
    >
      <span>.env</span>
      <span style={{ color: colors.green, fontSize: 14 }}>SYNCED</span>
    </div>
    <div style={{ ...mono, padding: '24px 20px 28px', fontSize: 21, color: colors.greenSoft }}>
      <div
        style={{
          opacity: interpolate(frame, [314, 332], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp'
          })
        }}
      >
        <span style={{ color: colors.blue }}>API_TOKEN</span>
        <span style={{ color: colors.muted }}>=</span>
        <span>••••••••••••</span>
      </div>
    </div>
  </div>
)

const Outro = () => {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(7,17,13,0.94)',
        opacity: interpolate(frame, [0, 18], [0, 1], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp'
        })
      }}
    >
      <div
        style={{
          color: colors.green,
          fontSize: 62,
          fontWeight: 850,
          letterSpacing: -2,
          opacity: interpolate(frame, [8, 26], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp'
          }),
          translate: interpolate(frame, [8, 26], ['0px 20px', '0px 0px'], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.bezier(0.16, 1, 0.3, 1)
          })
        }}
      >
        Hackvault
      </div>
      <div
        style={{
          marginTop: 18,
          color: colors.text,
          fontSize: 27,
          opacity: interpolate(frame, [18, 36], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp'
          })
        }}
      >
        Encrypted secrets. Synced where you build.
      </div>
      <div style={{ ...mono, marginTop: 28, color: colors.muted, fontSize: 18 }}>github.com/ram4-dev/pears-vault</div>
    </AbsoluteFill>
  )
}

export const HackvaultDemo = () => {
  const frame = useCurrentFrame()

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.background,
        backgroundImage:
          'linear-gradient(rgba(103,245,168,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(103,245,168,0.035) 1px, transparent 1px)',
        backgroundSize: '36px 36px',
        color: colors.text,
        fontFamily: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
      }}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 82% 22%, #153b2b 0, transparent 38%)' }} />

      <div style={{ position: 'absolute', top: 42, left: 68, right: 68, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
          <div
            style={{
              width: 42,
              height: 42,
              border: `1px solid ${colors.green}`,
              borderRadius: 12,
              display: 'grid',
              placeItems: 'center',
              color: colors.green,
              fontSize: 22,
              boxShadow: '0 0 30px rgba(103,245,168,0.18)'
            }}
          >
            ◈
          </div>
          <div>
            <div style={{ fontSize: 27, fontWeight: 800, letterSpacing: -0.6 }}>Hackvault</div>
            <div style={{ fontSize: 15, color: colors.muted, marginTop: 2 }}>P2P encrypted secret vault</div>
          </div>
        </div>
        <StatusPill frame={frame} start={72}>Host online</StatusPill>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 68,
          top: 130,
          width: interpolate(frame, [275, 304], [1144, 690], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
            easing: Easing.bezier(0.16, 1, 0.3, 1)
          }),
          height: 494,
          border: `1px solid ${colors.border}`,
          borderRadius: 20,
          background: 'rgba(8,22,16,0.94)',
          boxShadow: '0 30px 90px rgba(0,0,0,0.32)',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            height: 52,
            borderBottom: `1px solid ${colors.border}`,
            background: '#0b1813',
            display: 'flex',
            alignItems: 'center',
            padding: '0 18px',
            gap: 9
          }}
        >
          {['#ff6b6b', '#ffd166', colors.green].map(color => (
            <div key={color} style={{ width: 11, height: 11, borderRadius: 99, background: color, opacity: 0.85 }} />
          ))}
          <div style={{ ...mono, marginLeft: 12, color: colors.muted, fontSize: 15 }}>~/my-project</div>
        </div>

        <div style={{ ...mono, padding: '24px 24px' }}>
          <TerminalLine frame={frame} start={10} prompt>
            hackvault host start
          </TerminalLine>
          <TerminalLine frame={frame} start={50} tone="muted">
            HACKVAULT_PUBLIC_KEY=a8f2…91ce
          </TerminalLine>
          <TerminalLine frame={frame} start={76} tone="green">
            Host is serving encrypted vault replication.
          </TerminalLine>

          <div style={{ height: 18 }} />
          <TerminalLine frame={frame} start={132} prompt>
            hackvault add a8f2…91ce API_TOKEN demo-value
          </TerminalLine>
          <TerminalLine frame={frame} start={170} tone="green">
            {'{"ok":true,"name":"API_TOKEN"}'}
          </TerminalLine>

          <div style={{ height: 18 }} />
          <TerminalLine frame={frame} start={218} prompt>
            hackvault list a8f2…91ce
          </TerminalLine>
          <TerminalLine frame={frame} start={250} tone="blue">
            {'["API_TOKEN"]'}
          </TerminalLine>
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 700,
          top: 355,
          opacity: interpolate(frame, [285, 310], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp'
          })
        }}
      >
        <FlowArrow frame={frame} />
        <div style={{ marginTop: -10, marginLeft: 48, color: colors.muted, fontSize: 16, fontWeight: 700 }}>automatic mirror</div>
      </div>

      <EnvCard frame={frame} />

      <div
        style={{
          position: 'absolute',
          left: 68,
          bottom: 30,
          right: 68,
          display: 'flex',
          justifyContent: 'space-between',
          color: colors.muted,
          fontSize: 15,
          opacity: interpolate(frame, [320, 340], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp'
          })
        }}
      >
        <span>HyperDHT · Hypercore · Hyperbee · AES-256-GCM</span>
        <span style={{ color: colors.greenSoft }}>bidirectional .env sync</span>
      </div>

      <Sequence from={395} durationInFrames={55}>
        <Outro />
      </Sequence>
    </AbsoluteFill>
  )
}
