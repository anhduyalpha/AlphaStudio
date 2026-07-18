import React from 'react';
import Icon from './Icon';
import useAnimationActivity from '../hooks/useAnimationActivity';

// Signature "agents fan out" visual: an orchestrator core in the center with
// specialist agent nodes that radiate outward along connecting spokes. The
// fan-out plays on mount (and replays on route change because the whole view
// remounts via the `key={route}` on <main>).
const agents = [
  { icon: 'converter', label: 'Convert', color: 'purple', angle: -74 },
  { icon: 'pdf', label: 'Documents', color: 'cyan', angle: -44 },
  { icon: 'image', label: 'Images', color: 'blue', angle: -15 },
  { icon: 'media', label: 'Media', color: 'pink', angle: 15 },
  { icon: 'qr', label: 'QR', color: 'green', angle: 44 },
  { icon: 'developer', label: 'Developer', color: 'amber', angle: 74 },
];

export default function AgentFanOut() {
  const { ref, dataProps } = useAnimationActivity();
  return (
    <div className="agent-fan" role="img" aria-label="Orchestrator dispatching specialist agents that fan outward" ref={ref} {...dataProps}>
      <div className="agent-fan-rings" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <svg className="agent-fan-spokes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {agents.map((agent, index) => {
          const radians = (agent.angle * Math.PI) / 180;
          const x2 = 50 + Math.cos(radians) * 46;
          const y2 = 50 + Math.sin(radians) * 46;
          return (
            <line
              key={agent.label}
              className="agent-fan-spoke"
              x1="50"
              y1="50"
              x2={x2}
              y2={y2}
              style={{ '--fan-delay': `${260 + index * 90}ms` }}
            />
          );
        })}
      </svg>

      {agents.map((agent, index) => (
        <div
          key={agent.label}
          className={`agent-node color-${agent.color}`}
          style={{ '--fan-angle': `${agent.angle}deg`, '--fan-delay': `${320 + index * 90}ms` }}
        >
          <span className="agent-node-chip">
            <Icon name={agent.icon} size={19} />
          </span>
          <b>{agent.label}</b>
        </div>
      ))}

      <div className="agent-core">
        <span className="agent-core-pulse" aria-hidden="true" />
        <Icon name="sparkles" size={26} />
        <strong>Orchestrator</strong>
      </div>
    </div>
  );
}
