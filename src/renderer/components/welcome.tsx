import { useEffect, useState } from 'react'
import { cx } from '../api'
import { LogoMark } from '../ui'

/** Приветственный экран при запуске: только opacity/transform, поэтому не грузит UI. */
export function WelcomeScreen({ onDone, reduced }: { onDone: () => void; reduced: boolean }) {
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setLeaving(true), reduced ? 650 : 2100)
    const skip = () => setLeaving(true)
    window.addEventListener('keydown', skip)
    window.addEventListener('pointerdown', skip)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', skip)
      window.removeEventListener('pointerdown', skip)
    }
  }, [reduced])

  useEffect(() => {
    if (!leaving) return
    const timer = window.setTimeout(onDone, reduced ? 0 : 420)
    return () => window.clearTimeout(timer)
  }, [leaving, onDone, reduced])

  return (
    <div
      className={cx('welcome', leaving && 'welcome-leave', reduced && 'welcome-static')}
      role="status"
      aria-label="Добро пожаловать в Relax Launcher"
    >
      <div className="welcome-glow" />
      <div className="welcome-rings" />
      <div className="welcome-content">
        <div className="welcome-logo">
          <LogoMark size={62} />
        </div>
        <div className="welcome-kicker">RELAX LAUNCHER</div>
        <h1>Добро пожаловать</h1>
        <p>в Relax Launcher</p>
        <div className="welcome-bar">
          <span />
        </div>
        <small>Нажмите где угодно, чтобы пропустить</small>
      </div>
    </div>
  )
}
