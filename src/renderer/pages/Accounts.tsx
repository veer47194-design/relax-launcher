import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { SkinInfo } from '../../shared/types'
import { api, errText } from '../api'
import { useApp } from '../context'
import { Badge, Button, Card, ConfirmButton, EmptyState, Head, Icon, PageHeader, Spinner } from '../ui'

function ElyHead({ name, size = 52 }: { name: string; size?: number }) {
  return (
    <span
      className="head ely-head"
      style={
        {
          '--head-size': `${size}px`,
          backgroundImage: `url(https://skinsystem.ely.by/skins/${encodeURIComponent(name)}.png)`,
        } as CSSProperties
      }
      aria-hidden
    >
      <span className="ely-head-fallback">{name.slice(0, 2).toUpperCase()}</span>
    </span>
  )
}

/** Рисует переднюю проекцию скина из текстуры 64×64 без сглаживания. */
function SkinPreview({ url, slim, width = 168 }: { url: string | null; slim: boolean; width?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!url) return

    const image = new Image()
    image.onload = () => {
      const scale = canvas.width / 24
      ctx.imageSmoothingEnabled = false
      const arm = slim ? 3 : 4
      const parts: [number, number, number, number, number, number, number, number][] = [
        [8, 8, 8, 8, 4, 0, 8, 8], // голова
        [20, 20, 8, 12, 4, 8, 8, 12], // корпус
        [44, 20, arm, 12, 4 - arm, 8, arm, 12], // правая рука (слева на экране)
        [36, 52, arm, 12, 12, 8, arm, 12], // левая рука
        [4, 20, 4, 12, 4, 20, 4, 12], // правая нога
        [20, 52, 4, 12, 8, 20, 4, 12], // левая нога
      ]
      for (const [sx, sy, sw, sh, dx, dy, dw, dh] of parts) {
        ctx.drawImage(image, sx, sy, sw, sh, dx * scale, dy * scale, dw * scale, dh * scale)
      }
    }
    image.src = url
    return () => {
      image.onload = null
    }
  }, [url, slim])

  return (
    <canvas
      ref={ref}
      className="skin-canvas"
      width={168}
      height={224}
      style={{ width, height: (width / 168) * 224 }}
      aria-label="Предпросмотр скина"
    />
  )
}

export default function Accounts() {
  const { state, toast, refresh } = useApp()
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)

  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [needTotp, setNeedTotp] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [elyBusy, setElyBusy] = useState(false)

  const activeId = state.settings.activeAccountId
  const activeAccount = state.accounts.find((a) => a.id === activeId) ?? null
  const elyAccount =
    activeAccount?.type === 'ely'
      ? activeAccount
      : (state.accounts.find((a) => a.type === 'ely') ?? null)

  const [skin, setSkin] = useState<SkinInfo | null>(null)
  const [skinBusy, setSkinBusy] = useState(false)
  const [skinError, setSkinError] = useState<string | null>(null)
  const [skinNonce, setSkinNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (!elyAccount) {
      setSkin(null)
      setSkinError(null)
      return
    }
    setSkinBusy(true)
    setSkinError(null)
    api.accounts
      .skin(elyAccount.name)
      .then((info) => {
        if (!cancelled) setSkin(info)
      })
      .catch((e) => {
        if (!cancelled) {
          setSkin(null)
          setSkinError(errText(e))
        }
      })
      .finally(() => {
        if (!cancelled) setSkinBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [elyAccount?.name, skinNonce])

  const add = async () => {
    if (!name.trim()) return
    setAdding(true)
    try {
      await api.accounts.add(name)
      await refresh()
      toast(`Аккаунт «${name.trim()}» добавлен`, 'ok')
      setName('')
    } catch (e) {
      toast(errText(e), 'err')
    } finally {
      setAdding(false)
    }
  }

  const elyLogin = async () => {
    if (!login.trim() || !password) return
    setElyBusy(true)
    try {
      await api.accounts.elyLogin(login.trim(), password, needTotp ? totp : undefined)
      await refresh()
      toast('Вход через Ely.by выполнен', 'ok')
      setLogin('')
      setPassword('')
      setTotp('')
      setNeedTotp(false)
      setShowPassword(false)
    } catch (e) {
      const message = errText(e)
      if (/двухфактор|two[ -]?factor/i.test(message)) setNeedTotp(true)
      toast(message, 'err')
    } finally {
      setElyBusy(false)
    }
  }

  const select = async (id: string) => {
    try {
      await api.accounts.select(id)
      await refresh()
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  const remove = async (id: string) => {
    try {
      await api.accounts.remove(id)
      await refresh()
      toast('Аккаунт удалён', 'ok')
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  const copyUuid = async (uuid: string) => {
    try {
      await api.app.clipboard(uuid)
      toast('UUID скопирован', 'ok')
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  return (
    <div>
      <PageHeader
        title="Аккаунты"
        subtitle="Офлайн-профили и вход через Ely.by"
      />

      <div className="info-banner" style={{ marginBottom: 18 }}>
        <Icon name="shield" size={18} />
        <div>
          Офлайн-аккаунт работает в одиночной игре и на серверах с <b>online-mode=false</b>. Для
          серверов Ely.by и синхронизации скинов войдите в аккаунт Ely.by — лаунчер сам подключит
          authlib-injector при запуске.
        </div>
      </div>

      <div className="account-grid" style={{ marginBottom: 18 }}>
        {state.accounts.map((account) => {
          const active = account.id === activeId
          return (
            <Card key={account.id} className="account-card">
              <div className="account-top">
                {account.type === 'ely' ? (
                  <ElyHead name={account.name} />
                ) : (
                  <Head name={account.name} size={52} />
                )}
                <div className="account-info grow">
                  <div className="account-name-row">
                    <strong title={account.name}>{account.name}</strong>
                    {account.type === 'ely' && <Badge tone="accent">Ely.by</Badge>}
                    {active && <Badge tone="green">Активный</Badge>}
                  </div>
                  <button className="account-uuid" title="Скопировать UUID" onClick={() => copyUuid(account.uuid)}>
                    <span>{account.uuid}</span>
                    <Icon name="copy" size={12} />
                  </button>
                </div>
              </div>
              <div className="account-controls">
                {active ? (
                  <span className="tiny">Используется для запуска игр</span>
                ) : (
                  <Button size="sm" variant="soft" onClick={() => select(account.id)}>
                    Выбрать
                  </Button>
                )}
                <ConfirmButton size="sm" onConfirm={() => remove(account.id)} confirmText="Удалить?">
                  Удалить
                </ConfirmButton>
              </div>
            </Card>
          )
        })}
        {state.accounts.length === 0 && (
          <div style={{ gridColumn: '1 / -1' }}>
            <EmptyState
              icon="user"
              title="Аккаунтов пока нет"
              text="Создайте офлайн-аккаунт или войдите через Ely.by — пароль от Ely.by нигде не сохраняется."
            />
          </div>
        )}
      </div>

      {elyAccount && (
        <Card className="skin-card">
          <div className="skin-preview-wrap">
            <SkinPreview
              url={
                skin?.url ??
                `https://skinsystem.ely.by/skins/${encodeURIComponent(elyAccount.name)}.png`
              }
              slim={skin?.model === 'slim'}
              width={150}
            />
          </div>
          <div className="skin-info grow">
            <div className="settings-card-head">
              <div className="settings-icon ely-icon">
                <Icon name="user" size={18} />
              </div>
              <div className="grow">
                <h3 style={{ fontSize: 14.5 }}>Скин Ely.by</h3>
                <p className="tiny">Текущая текстура аккаунта {elyAccount.name}</p>
              </div>
              {skin?.model && <Badge tone="accent">{skin.model === 'slim' ? 'Slim' : 'Classic'}</Badge>}
            </div>

            <div className="skin-status">
              {skinBusy ? (
                <>
                  <Spinner size={14} /> Загрузка текстуры…
                </>
              ) : skinError ? (
                <>
                  <Icon name="alert" size={15} /> {skinError}
                </>
              ) : skin?.url ? (
                <>
                  <Icon name="check" size={15} /> Скин синхронизируется через authlib-injector
                </>
              ) : (
                <>
                  <Icon name="info" size={15} /> У аккаунта пока нет скина
                </>
              )}
            </div>

            <div className="row" style={{ marginTop: 12 }}>
              <Button
                variant="primary"
                icon="external"
                onClick={() => api.app.openExternal('https://ely.by/skins')}
              >
                Сменить на Ely.by
              </Button>
              <Button
                variant="ghost"
                icon="refresh"
                loading={skinBusy}
                onClick={() => setSkinNonce((n) => n + 1)}
              >
                Обновить
              </Button>
            </div>

            <p className="tiny skin-note">
              Ely.by меняет скин только на сайте — официальный API отдаёт текстуры лишь для
              чтения. После сохранения нажмите «Обновить»: игра подхватит скин при следующем
              запуске.
            </p>
          </div>
        </Card>
      )}

      <div className="account-auth-grid">
        <Card className="ely-card">
          <div className="settings-card-head">
            <div className="settings-icon ely-icon">
              <Icon name="shield" size={18} />
            </div>
            <div className="grow">
              <h3 style={{ fontSize: 14.5 }}>Вход через Ely.by</h3>
              <p className="tiny">Логин или почта, пароль и код 2FA при необходимости</p>
            </div>
            <Badge tone="accent">Ely.by</Badge>
          </div>

          <div className="ely-form">
            <label className="ely-field">
              <span>Логин или почта</span>
              <input
                className="input"
                value={login}
                placeholder="nickname или mail@example.com"
                autoComplete="username"
                spellCheck={false}
                onChange={(e) => setLogin(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void elyLogin()}
              />
            </label>

            <label className="ely-field">
              <span>Пароль</span>
              <div className="ely-pass">
                <input
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  placeholder="Пароль Ely.by"
                  autoComplete="current-password"
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void elyLogin()}
                />
                <button
                  type="button"
                  className="ely-pass-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? 'Скрыть' : 'Показать'}
                </button>
              </div>
            </label>

            {needTotp && (
              <label className="ely-field">
                <span>Код двухфакторной защиты</span>
                <input
                  className="input"
                  value={totp}
                  placeholder="6 цифр из приложения"
                  inputMode="numeric"
                  maxLength={8}
                  onChange={(e) => setTotp(e.target.value.replace(/\s/g, ''))}
                  onKeyDown={(e) => e.key === 'Enter' && void elyLogin()}
                />
              </label>
            )}

            <div className="ely-actions">
              <Button
                variant="primary"
                icon="user"
                loading={elyBusy}
                disabled={!login.trim() || !password}
                onClick={elyLogin}
              >
                Войти
              </Button>
              <Button
                variant="ghost"
                icon="external"
                onClick={() => api.app.openExternal('https://account.ely.by/register')}
              >
                Создать аккаунт
              </Button>
            </div>
          </div>

          <div className="tiny ely-note">
            Пароль используется только для получения сессии и не сохраняется. При запуске лаунчер
            продлевает токен Ely.by автоматически.
          </div>
        </Card>

        <Card className="add-account">
          <div className="settings-card-head">
            <div className="settings-icon">
              <Icon name="plus" size={18} />
            </div>
            <div>
              <h3 style={{ fontSize: 14.5 }}>Новый офлайн-аккаунт</h3>
              <p className="tiny">3–16 символов: латиница, цифры и «_»</p>
            </div>
          </div>
          <div className="add-account-row">
            <input
              className="input"
              value={name}
              placeholder="Ваш никнейм"
              maxLength={16}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
            <Button variant="primary" icon="plus" loading={adding} disabled={!name.trim()} onClick={add}>
              Добавить
            </Button>
          </div>
          <div className="tiny">
            Подходит для одиночной игры и серверов без проверки Mojang. UUID вычисляется локально.
          </div>
        </Card>
      </div>
    </div>
  )
}
