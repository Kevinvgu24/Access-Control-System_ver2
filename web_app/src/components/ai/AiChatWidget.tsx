import React, { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Bot,
  User as UserIcon,
  X,
  Send,
  Table,
  HelpCircle,
  RefreshCw,
  Zap,
  ExternalLink
} from 'lucide-react'
import { useLabStore } from '@/store/labStore'


interface Message {
  id: string
  sender: 'user' | 'assistant'
  text: string
  timestamp: string
  isTableAnalysis?: boolean
}

interface AIStatus {
  status: 'online' | 'offline' | 'checking'
  model: string
  api_base?: string
  error?: string
}

export const AiChatWidget: React.FC = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { selectedLabId } = useLabStore()

  
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: 'Hello! I am your **VGU AI Assistant (Qwen 2.5 Coder 1.5B)**.\n\nI can assist you with analyzing table data, auditing access logs, and providing step-by-step guidance for operating the management system.\n\nClick **"Analyze Current Table"** or select a quick prompt below to get started!',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ])
  const [inputPrompt, setInputPrompt] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [aiStatus, setAiStatus] = useState<AIStatus>({ status: 'checking', model: 'qwen2.5-coder:1.5b' })
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Map route to page key
  const getPageKey = (): string => {
    const path = location.pathname.toLowerCase()
    if (path.includes('users')) return 'users'
    if (path.includes('enrollment')) return 'enrollment'
    if (path.includes('equipment')) return 'equipment'
    if (path.includes('schedules')) return 'schedules'
    if (path.includes('logs')) return 'logs'
    if (path.includes('system')) return 'system'
    return 'overview'
  }

  const pageKey = getPageKey()

  const checkStatus = async () => {
    setAiStatus(prev => ({ ...prev, status: 'checking' }))
    try {
      const res = await fetch('/api/ai/status')
      if (res.ok) {
        const data = await res.json()
        setAiStatus({
          status: data.status === 'online' ? 'online' : 'offline',
          model: data.model || 'qwen2.5-coder:1.5b',
          api_base: data.api_base,
          error: data.error
        })
      } else {
        setAiStatus({ status: 'offline', model: 'qwen2.5-coder:1.5b', error: 'HTTP error' })
      }
    } catch {
      setAiStatus({ status: 'offline', model: 'qwen2.5-coder:1.5b', error: 'Network error' })
    }
  }

  useEffect(() => {
    checkStatus()
  }, [])

  useEffect(() => {
    if (isOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isOpen])

  const handleSendMessage = async (customPrompt?: string, isTableReq = false) => {
    const textToSend = customPrompt || inputPrompt.trim()
    if (!textToSend || isLoading) return

    const userMsg: Message = {
      id: Date.now().toString(),
      sender: 'user',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isTableAnalysis: isTableReq
    }

    setMessages(prev => [...prev, userMsg])
    if (!customPrompt) setInputPrompt('')
    setIsLoading(true)

    // Build chat history for API
    const historyPayload = messages.map(m => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.text
    }))

    try {
      if (!isTableReq && typeof window !== 'undefined' && 'ReadableStream' in window) {
        const res = await fetch('/api/ai/chat-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: textToSend,
            page: pageKey,
            labId: selectedLabId,
            history: historyPayload
          })
        })

        if (!res.ok || !res.body) {
          throw new Error(`HTTP error ${res.status}`)
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder('utf-8')
        let fullText = ''
        let pendingRoute: string | null = null
        let aiMsgId: string | null = null

        while (true) {
          const { value, done } = await reader.read()
          if (done) break

          const chunkText = decoder.decode(value, { stream: true })
          const lines = chunkText.split('\n')
          
          for (const line of lines) {
            const cleanLine = line.trim()
            if (cleanLine.startsWith('data: ')) {
              try {
                const jsonStr = cleanLine.slice(6)
                const parsed = JSON.parse(jsonStr)
                if (parsed.token) {
                  fullText += parsed.token
                  if (!aiMsgId) {
                    // First token arrived: Turn off thinking indicator and insert single AI message bubble
                    aiMsgId = (Date.now() + 1).toString()
                    setIsLoading(false)
                    setMessages(prev => [
                      ...prev,
                      {
                        id: aiMsgId!,
                        sender: 'assistant',
                        text: fullText,
                        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      }
                    ])
                  } else {
                    setMessages(prev =>
                      prev.map(m => m.id === aiMsgId ? { ...m, text: fullText } : m)
                    )
                  }
                }
                if (parsed.action === 'NAVIGATE' && parsed.target_route) {
                  pendingRoute = parsed.target_route
                }
              } catch (e) {
                // Ignore parse errors on incomplete chunk boundaries
              }
            }
          }
        }

        if (pendingRoute) {
          setTimeout(() => {
            navigate(pendingRoute!)
          }, 500)
        }
      } else {
        const endpoint = isTableReq ? '/api/ai/analyze-table' : '/api/ai/chat'
        const bodyPayload = isTableReq
          ? { page: pageKey, labId: selectedLabId }
          : {
              prompt: textToSend,
              page: pageKey,
              labId: selectedLabId,
              history: historyPayload
            }

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyPayload)
        })

        const data = await res.json()

        const aiMsg: Message = {
          id: (Date.now() + 1).toString(),
          sender: 'assistant',
          text: data.response || data.error || 'No response received from AI model.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }

        setMessages(prev => [...prev, aiMsg])

        if (data.action === 'NAVIGATE' && data.target_route) {
          setTimeout(() => {
            navigate(data.target_route)
          }, 500)
        }
      }
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: 'assistant',
          text: `⚠️ **Connection Error**: Unable to connect to API server. (${err.message})`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ])
    } finally {
      setIsLoading(false)
    }
  }

  // Quick Action Chips per page in English
  const getQuickPrompts = () => {
    switch (pageKey) {
      case 'users':
        return [
          { label: '📊 Summarize Users Table', action: () => handleSendMessage(undefined, true) },
          { label: '❓ How to Add New User', action: () => handleSendMessage('What are the step-by-step instructions to add a new user to the system?') },
          { label: '🔑 PIN & Access Permission Guide', action: () => handleSendMessage('How do I assign PIN codes or modify user access permissions?') }
        ]
      case 'equipment':
        return [
          { label: '📦 Read Equipment List', action: () => handleSendMessage(undefined, true) },
          { label: '⚠️ Overdue Equipment Check', action: () => handleSendMessage('Check the equipment table and list all items currently overdue along with borrowers.') },
          { label: '📝 Borrow / Return Guide', action: () => handleSendMessage('What is the procedure for borrowing and returning lab equipment?') }
        ]
      case 'schedules':
        return [
          { label: '📅 Read Schedule Table', action: () => handleSendMessage(undefined, true) },
          { label: '📁 Excel Import Guide', action: () => handleSendMessage('What are the steps to import lab schedules from an Excel (.xlsx) file?') }
        ]
      case 'logs':
        return [
          { label: '🔍 Read Access Logs', action: () => handleSendMessage(undefined, true) },
          { label: '🚨 Summarize Security Alerts', action: () => handleSendMessage('Summarize recent security incidents and unauthorized access attempts from the log table.') }
        ]
      default:
        return [
          { label: '📊 Analyze Current Table', action: () => handleSendMessage(undefined, true) },
          { label: '💡 Page Feature Guide', action: () => handleSendMessage(`Explain the key features and operational workflow for the ${pageKey.toUpperCase()} page.`) }
        ]
    }
  }

  // Helper Markdown renderer
  const renderFormattedText = (content: string) => {
    const lines = content.split('\n')
    let inTable = false
    let tableRows: string[][] = []

    const elements: React.ReactNode[] = []

    lines.forEach((line, idx) => {
      const trimmed = line.trim()

      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        inTable = true
        const cells = trimmed
          .split('|')
          .slice(1, -1)
          .map(c => c.trim())
        
        if (!cells.every(c => /^:?-+:?$/.test(c))) {
          tableRows.push(cells)
        }
        return
      } else if (inTable) {
        inTable = false
        if (tableRows.length > 0) {
          const header = tableRows[0]
          const body = tableRows.slice(1)
          elements.push(
            <div key={`table-${idx}`} className="my-2 overflow-x-auto border border-orange-200 rounded-md shadow-xs">
              <table className="min-w-full text-xs text-left divide-y divide-orange-100">
                <thead className="bg-orange-50 font-bold text-orange-950">
                  <tr>
                    {header.map((h, i) => (
                      <th key={i} className="px-2.5 py-1.5 border-r border-orange-200 last:border-r-0">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
                  {body.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-orange-50/50 transition-colors">
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="px-2.5 py-1 border-r border-slate-100 last:border-r-0 whitespace-nowrap">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
          tableRows = []
        }
      }

      if (trimmed.startsWith('### ')) {
        elements.push(<h3 key={idx} className="font-bold text-sm text-orange-900 mt-2 mb-1">{trimmed.replace('### ', '')}</h3>)
      } else if (trimmed.startsWith('## ')) {
        elements.push(<h2 key={idx} className="font-bold text-base text-orange-950 mt-2 mb-1">{trimmed.replace('## ', '')}</h2>)
      } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        const itemText = trimmed.substring(2)
        elements.push(
          <li key={idx} className="ml-3 list-disc text-xs text-slate-800 my-0.5">
            {formatBoldText(itemText)}
          </li>
        )
      } else if (/^\d+\.\s/.test(trimmed)) {
        elements.push(
          <div key={idx} className="text-xs text-slate-800 my-1 font-medium pl-1">
            {formatBoldText(trimmed)}
          </div>
        )
      } else if (trimmed === '') {
        elements.push(<div key={idx} className="h-1.5" />)
      } else {
        elements.push(
          <p key={idx} className="text-xs text-slate-800 leading-relaxed my-0.5">
            {formatBoldText(trimmed)}
          </p>
        )
      }
    })

    if (inTable && tableRows.length > 0) {
      const header = tableRows[0]
      const body = tableRows.slice(1)
      elements.push(
        <div key="table-end" className="my-2 overflow-x-auto border border-orange-200 rounded-md shadow-xs">
          <table className="min-w-full text-xs text-left divide-y divide-orange-100">
            <thead className="bg-orange-50 font-bold text-orange-950">
              <tr>
                {header.map((h, i) => (
                  <th key={i} className="px-2 py-1.5 border-r border-orange-200 last:border-r-0">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white text-slate-800">
              {body.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-orange-50/50 transition-colors">
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-2 py-1 border-r border-slate-100 last:border-r-0 whitespace-nowrap">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }

    return elements
  }

  const formatBoldText = (text: string) => {
    const parts = text.split(/(\*\*.*?\*\*|`.*?`|\[.*?\]\(.*?\))/g)
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="font-bold text-slate-900">{part.slice(2, -2)}</strong>
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={i} className="bg-orange-50 text-orange-800 font-mono text-[11px] px-1 py-0.5 rounded border border-orange-200">{part.slice(1, -1)}</code>
      }
      if (part.startsWith('[') && part.includes('](') && part.endsWith(')')) {
        const match = part.match(/^\[(.*?)\]\((.*?)\)$/)
        if (match) {
          const label = match[1]
          const url = match[2]
          return (
            <button
              key={i}
              onClick={() => {
                if (url.startsWith('/')) {
                  navigate(url)
                } else {
                  window.open(url, '_blank')
                }
              }}
              className="inline-flex items-center gap-1 font-semibold text-orange-700 hover:text-orange-900 bg-orange-100/90 hover:bg-orange-200 px-2 py-0.5 rounded-md border border-orange-300/80 text-[11px] transition-colors cursor-pointer shadow-2xs my-0.5 mx-0.5"
              title={`Navigate to ${label}`}
            >
              <span>{label}</span>
              <ExternalLink className="w-3 h-3 text-orange-600 shrink-0" />
            </button>
          )
        }
      }
      return part
    })
  }


  return (
    <>
      {/* Small Circular Avatar Toggle Button (VGU White-Orange Theme) */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-tr from-orange-600 to-amber-500 text-white shadow-xl shadow-orange-500/30 hover:scale-110 active:scale-95 transition-all duration-200 cursor-pointer border-2 border-white flex items-center justify-center group"
          title="Open VGU AI Assistant"
        >
          <div className="relative flex items-center justify-center">
            <Bot className="w-7 h-7 text-white drop-shadow-xs transition-transform group-hover:rotate-12" />
            <span
              className={`absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full border-2 border-white ${
                aiStatus.status === 'online' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'
              }`}
            />
          </div>
        </button>
      )}

      {/* Floating AI Drawer Window (VGU White-Orange Theme - Compact 25% Smaller) */}
      {isOpen && (
        <div className="fixed bottom-5 right-5 z-50 w-[88vw] sm:w-[340px] h-[450px] max-h-[75vh] bg-white border border-orange-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-5 duration-200">
          
          {/* Header - VGU Orange Theme */}
          <div className="bg-gradient-to-r from-orange-600 via-orange-500 to-amber-500 text-white px-3.5 py-2.5 flex items-center justify-between shadow-xs shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-xs border border-white/30 flex items-center justify-center text-white shrink-0 shadow-xs">
                <Bot className="w-4.5 h-4.5 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="font-bold text-xs tracking-tight text-white">VGU AI Assistant</h3>
                  <span className="text-[9px] font-mono bg-white/20 text-white px-1.5 py-0.2 rounded border border-white/30 uppercase font-semibold">
                    1.5B
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[10px] text-orange-100 font-medium">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      aiStatus.status === 'online' ? 'bg-emerald-400 shadow-emerald-400/50 shadow-sm' : 'bg-amber-300'
                    }`}
                  />
                  <span>
                    {aiStatus.status === 'online'
                      ? 'Local Online'
                      : aiStatus.status === 'checking'
                      ? 'Connecting...'
                      : 'AI Offline'}
                  </span>
                  <button
                    onClick={checkStatus}
                    className="ml-0.5 text-orange-100 hover:text-white p-0.5 rounded transition-colors"
                    title="Recheck API connection"
                  >
                    <RefreshCw className={`w-2.5 h-2.5 ${aiStatus.status === 'checking' ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setMessages([messages[0]])}
                className="px-1.5 py-0.5 text-orange-100 hover:text-white hover:bg-white/10 rounded-md transition-colors text-[10px] font-mono"
                title="Clear chat history"
              >
                Clear
              </button>
              {/* Prominent High-Contrast Red Close Button */}
              <button
                onClick={() => setIsOpen(false)}
                className="bg-red-500/90 hover:bg-red-600 text-white rounded-full p-1.5 shadow-md border border-white/40 transition-transform hover:scale-110 active:scale-95 cursor-pointer ml-1"
                title="Close AI Assistant"
              >
                <X className="w-4 h-4 stroke-[2.5]" />
              </button>
            </div>
          </div>


          {/* Current Page Context Ribbon (VGU White-Orange) */}
          <div className="bg-orange-50/70 border-b border-orange-100 px-3 py-1.5 flex items-center justify-between shrink-0 text-xs">
            <div className="flex items-center gap-1.5 text-orange-950 font-mono">
              <Zap className="w-3.5 h-3.5 text-orange-600 fill-orange-600" />
              <span className="text-[11px]">Page:</span>
              <span className="font-bold text-orange-700 uppercase bg-white px-2 py-0.5 rounded border border-orange-200 text-[11px]">
                {pageKey}
              </span>
            </div>
            <button
              onClick={() => handleSendMessage(undefined, true)}
              disabled={isLoading}
              className="flex items-center gap-1 text-[11px] font-semibold text-white bg-orange-600 hover:bg-orange-700 px-2.5 py-1 rounded-lg transition-colors border border-orange-700/30 shadow-xs cursor-pointer disabled:opacity-50"
            >
              <Table className="w-3.5 h-3.5" />
              <span>Analyze Current Table</span>
            </button>
          </div>

          {/* Chat Messages Container */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 bg-slate-50/40">
            {messages
              .filter(msg => msg.sender === 'user' || msg.text.trim().length > 0)
              .map(msg => (
              <div
                key={msg.id}
                className={`flex gap-2.5 ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.sender === 'assistant' && (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-orange-600 to-amber-500 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-xs border border-orange-300">
                    <Bot className="w-4 h-4 text-white" />
                  </div>
                )}

                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 shadow-xs ${
                    msg.sender === 'user'
                      ? 'bg-orange-600 text-white rounded-br-none'
                      : 'bg-white text-slate-800 border border-slate-200/80 rounded-bl-none'
                  }`}
                >
                  {msg.sender === 'user' ? (
                    <p className="text-xs leading-relaxed font-medium">{msg.text}</p>
                  ) : (
                    <div>{renderFormattedText(msg.text)}</div>
                  )}
                  <span
                    className={`block text-[9px] mt-1 text-right font-mono ${
                      msg.sender === 'user' ? 'text-orange-100' : 'text-slate-400'
                    }`}
                  >
                    {msg.timestamp}
                  </span>
                </div>

                {msg.sender === 'user' && (
                  <div className="w-8 h-8 rounded-full bg-slate-700 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
                    <UserIcon className="w-4 h-4 text-slate-200" />
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-2.5 items-center">
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-orange-600 to-amber-500 text-white flex items-center justify-center shrink-0 shadow-xs border border-orange-300">
                  <Bot className="w-4 h-4 text-white animate-spin" />
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 shadow-xs flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-orange-600 animate-bounce" />
                  <span className="w-2 h-2 rounded-full bg-orange-600 animate-bounce [animation-delay:0.2s]" />
                  <span className="w-2 h-2 rounded-full bg-orange-600 animate-bounce [animation-delay:0.4s]" />
                  <span className="text-xs text-orange-950 font-medium ml-1">VGU AI is thinking...</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Quick Prompts Bar */}
          <div className="px-3 py-2 bg-white border-t border-slate-200/80 shrink-0">
            <p className="text-[10px] font-semibold text-orange-900 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <HelpCircle className="w-3 h-3 text-orange-600" /> Quick Prompts:
            </p>
            <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              {getQuickPrompts().map((qp, idx) => (
                <button
                  key={idx}
                  onClick={qp.action}
                  disabled={isLoading}
                  className="text-[11px] whitespace-nowrap bg-orange-50/80 hover:bg-orange-100 text-orange-900 px-3 py-1 rounded-full border border-orange-200/80 transition-colors shrink-0 cursor-pointer disabled:opacity-50 font-medium"
                >
                  {qp.label}
                </button>
              ))}
            </div>
          </div>

          {/* Input Box */}
          <div className="p-3 bg-slate-50 border-t border-slate-200/80 shrink-0">
            <form
              onSubmit={e => {
                e.preventDefault()
                handleSendMessage()
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={inputPrompt}
                onChange={e => setInputPrompt(e.target.value)}
                placeholder="Ask AI about tables, user guides..."
                disabled={isLoading}
                className="flex-1 bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={isLoading || !inputPrompt.trim()}
                className="bg-orange-600 hover:bg-orange-700 text-white p-2 rounded-xl transition-colors disabled:opacity-40 disabled:hover:bg-orange-600 cursor-pointer shrink-0 shadow-xs"
                title="Send Question"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>

        </div>
      )}
    </>
  )
}
