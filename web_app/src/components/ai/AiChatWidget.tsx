import React, { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Sparkles,
  Bot,
  User as UserIcon,
  X,
  Send,
  Table,
  HelpCircle,
  RefreshCw,
  Zap
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
  const { selectedLabId } = useLabStore()
  
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: 'Xin chào! Tôi là **Trợ lý AI VGU (Qwen 2.5 Coder)**.\n\nTôi có thể hỗ trợ bạn đọc & tóm tắt dữ liệu bảng, phân tích nhật ký ra vào, và hướng dẫn thao tác trực tiếp trên hệ thống quản lý.\n\nBấm nút **"Đọc bảng trang này"** hoặc chọn câu hỏi gợi ý bên dưới để bắt đầu!',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ])
  const [inputPrompt, setInputPrompt] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [aiStatus, setAiStatus] = useState<AIStatus>({ status: 'checking', model: 'qwen2.5-coder:3b' })
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
          model: data.model || 'qwen2.5-coder:3b',
          api_base: data.api_base,
          error: data.error
        })
      } else {
        setAiStatus({ status: 'offline', model: 'qwen2.5-coder:3b', error: 'HTTP error' })
      }
    } catch {
      setAiStatus({ status: 'offline', model: 'qwen2.5-coder:3b', error: 'Network error' })
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
        text: data.response || data.error || 'Không nhận được phản hồi từ mô hình.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }

      setMessages(prev => [...prev, aiMsg])
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: 'assistant',
          text: `⚠️ **Lỗi kết nối**: Không thể kết nối tới server API. (${err.message})`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ])
    } finally {
      setIsLoading(false)
    }
  }

  // Quick Action Chips per page
  const getQuickPrompts = () => {
    switch (pageKey) {
      case 'users':
        return [
          { label: '📊 Tóm tắt bảng người dùng', action: () => handleSendMessage(undefined, true) },
          { label: '❓ Hướng dẫn thêm người dùng', action: () => handleSendMessage('Hướng dẫn từng bước cách thêm người dùng mới vào hệ thống?') },
          { label: '🔑 Hướng dẫn đổi mã PIN', action: () => handleSendMessage('Làm thế nào để cấp quyền hoặc đổi mã PIN cho người dùng?') }
        ]
      case 'equipment':
        return [
          { label: '📦 Đọc danh sách thiết bị', action: () => handleSendMessage(undefined, true) },
          { label: '⚠️ Thiết bị nào đang quá hạn?', action: () => handleSendMessage('Kiểm tra danh sách các thiết bị đang quá hạn mượn và cho biết ai đang mượn?') },
          { label: '📝 Hướng dẫn mượn/trả', action: () => handleSendMessage('Quy trình mượn và trả thiết bị phòng lab được thực hiện như thế nào?') }
        ]
      case 'schedules':
        return [
          { label: '📅 Đọc bảng lịch trình', action: () => handleSendMessage(undefined, true) },
          { label: '📁 Hướng dẫn nhập Excel', action: () => handleSendMessage('Các bước nhập lịch trình phòng Lab từ tệp Excel (.xlsx)?') }
        ]
      case 'logs':
        return [
          { label: '🔍 Đọc nhật ký ra vào', action: () => handleSendMessage(undefined, true) },
          { label: '🚨 Tóm tắt các cảnh báo vi phạm', action: () => handleSendMessage('Tóm tắt các sự cố và lượt truy cập bị từ chối gần đây trong bảng nhật ký.') }
        ]
      default:
        return [
          { label: '📊 Phân tích dữ liệu bảng trang này', action: () => handleSendMessage(undefined, true) },
          { label: '💡 Tóm tắt tính năng trang này', action: () => handleSendMessage(`Giải thích các tính năng chính và hướng dẫn thao tác trên trang ${pageKey.toUpperCase()}`) }
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
    const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g)
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="font-bold text-slate-900">{part.slice(2, -2)}</strong>
      }
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={i} className="bg-orange-50 text-orange-800 font-mono text-[11px] px-1 py-0.5 rounded border border-orange-200">{part.slice(1, -1)}</code>
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
          title="Mở Trợ lý AI VGU Qwen"
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

      {/* Floating AI Drawer Window (VGU White-Orange Theme) */}
      {isOpen && (
        <div className="fixed bottom-5 right-5 z-50 w-[92vw] sm:w-[440px] h-[580px] max-h-[85vh] bg-white border border-orange-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-5 duration-200">
          
          {/* Header - VGU Orange Theme */}
          <div className="bg-gradient-to-r from-orange-600 via-orange-500 to-amber-500 text-white px-4 py-3.5 flex items-center justify-between shadow-xs shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-full bg-white/20 backdrop-blur-xs border border-white/30 flex items-center justify-center text-white shrink-0 shadow-xs">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-sm tracking-tight text-white">VGU AI Assistant</h3>
                  <span className="text-[10px] font-mono bg-white/20 text-white px-1.5 py-0.5 rounded border border-white/30 uppercase font-semibold">
                    Qwen 2.5
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-orange-100 font-medium">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      aiStatus.status === 'online' ? 'bg-emerald-400 shadow-emerald-400/50 shadow-sm' : 'bg-amber-300'
                    }`}
                  />
                  <span>
                    {aiStatus.status === 'online'
                      ? 'Local Service Online'
                      : aiStatus.status === 'checking'
                      ? 'Đang kết nối AI...'
                      : 'AI Offline'}
                  </span>
                  <button
                    onClick={checkStatus}
                    className="ml-1 text-orange-100 hover:text-white p-0.5 rounded transition-colors"
                    title="Kiểm tra lại kết nối API"
                  >
                    <RefreshCw className={`w-3 h-3 ${aiStatus.status === 'checking' ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setMessages([messages[0]])}
                className="p-1.5 text-orange-100 hover:text-white hover:bg-white/10 rounded-lg transition-colors text-xs font-mono"
                title="Xóa cuộc trò chuyện"
              >
                Clear
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 text-orange-100 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Current Page Context Ribbon (VGU White-Orange) */}
          <div className="bg-orange-50/70 border-b border-orange-100 px-3 py-1.5 flex items-center justify-between shrink-0 text-xs">
            <div className="flex items-center gap-1.5 text-orange-950 font-mono">
              <Zap className="w-3.5 h-3.5 text-orange-600 fill-orange-600" />
              <span className="text-[11px]">Trang:</span>
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
              <span>Đọc bảng trang này</span>
            </button>
          </div>

          {/* Chat Messages Container */}
          <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 bg-slate-50/40">
            {messages.map(msg => (
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
                  <span className="text-xs text-orange-950 font-medium ml-1">VGU AI đang suy nghĩ...</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Quick Prompts Bar */}
          <div className="px-3 py-2 bg-white border-t border-slate-200/80 shrink-0">
            <p className="text-[10px] font-semibold text-orange-900 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <HelpCircle className="w-3 h-3 text-orange-600" /> Gợi ý câu hỏi nhanh:
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
                placeholder="Hỏi AI về dữ liệu bảng, hướng dẫn thao tác..."
                disabled={isLoading}
                className="flex-1 bg-white border border-slate-300 rounded-xl px-3.5 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition-all disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={isLoading || !inputPrompt.trim()}
                className="bg-orange-600 hover:bg-orange-700 text-white p-2 rounded-xl transition-colors disabled:opacity-40 disabled:hover:bg-orange-600 cursor-pointer shrink-0 shadow-xs"
                title="Gửi câu hỏi"
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
