import { Input } from '@/components/ui/input'
import { useLocalApiServer } from '@/hooks/useLocalApiServer'
import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { cn } from '@/lib/utils'

const HOSTNAME_RE = /^(?:(?:\d{1,3}\.){3}\d{1,3}|(?:[a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9])(?:\.(?:[a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]))*)(?::\d{1,5})?$/

function isValidHost(host: string): boolean {
  if (!host) return false
  return HOSTNAME_RE.test(host)
}

export function TrustedHostsInput({
  isServerRunning,
}: {
  isServerRunning?: boolean
}) {
  const { trustedHosts, setTrustedHosts } = useLocalApiServer()
  const [inputValue, setInputValue] = useState(trustedHosts.join(', '))
  const { t } = useTranslation()

  // Update input value when trustedHosts changes externally
  useEffect(() => {
    setInputValue(trustedHosts.join(', '))
  }, [trustedHosts])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInputValue(value)
  }

  const parseResult = useMemo(() => {
    const hosts = inputValue
      .split(',')
      .map((host) => host.trim())
      .filter((host) => host.length > 0)
    const valid = hosts.filter(isValidHost)
    return { valid }
  }, [inputValue])

  const handleBlur = () => {
    const { valid } = parseResult

    const uniqueHosts = [...new Set(valid)]
    setTrustedHosts(uniqueHosts)
    setInputValue(uniqueHosts.join(', '))
  }

  return (
    <Input
      type="text"
      value={inputValue}
      onChange={handleChange}
      onBlur={handleBlur}
      placeholder={t('common:enterTrustedHosts')}
      className={cn(
        'h-8 text-sm',
        isServerRunning && 'opacity-50 pointer-events-none'
      )}
    />
  )
}
