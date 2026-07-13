import { useEffect, useMemo, useRef, useState } from 'react'
import type { FC, ReactNode } from 'react'
import {
  Button,
  Col,
  Form,
  Input,
  Modal,
  Popconfirm,
  Row,
  Select,
  Switch,
  Tag,
  Tabs,
  Table as AntTable,
  Tooltip,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  HolderOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import axios from 'axios'
import dayjs from 'dayjs'
import StepperInput from './StepperInput'
import { formatAmount } from '../utils/money'
import { useAuth } from '../auth/AuthContext'
import { RoleManagementPanel, UserManagementPanel } from './AccessManagement'
import SettingsTableFrame from './SettingsTableFrame'
import SystemLogPanel from './SystemLogPanel'

type SettingsTab = 'category' | 'item' | 'area' | 'table' | 'voucher' | 'production' | 'user' | 'role' | 'audit'

const TAB_META: Record<SettingsTab, { label: string; addLabel: string }> = {
  category: { label: '类别管理', addLabel: '添加类别' },
  item: { label: '商品管理', addLabel: '添加商品' },
  area: { label: '区域管理', addLabel: '添加区域' },
  table: { label: '桌台管理', addLabel: '添加桌台' },
  voucher: { label: '优惠券管理', addLabel: '添加优惠券' },
  production: { label: '制作单管理', addLabel: '' },
  user: { label: '用户管理', addLabel: '' },
  role: { label: '角色权限', addLabel: '' },
  audit: { label: '系统日志', addLabel: '' },
}

interface MenuItem {
  id: number
  name: string
  price: number
  english_name?: string
  abv?: string
  description?: string
  sale_status?: 'on_sale' | 'off_sale'
  owned_by_current_user?: boolean
}

interface Category {
  name: string
  items: MenuItem[]
  owned_by_current_user?: boolean
}

interface MenuData {
  shop_name?: string
  categories: Category[]
}

interface ItemRow extends MenuItem {
  category: string
  key: string
}

interface TableArea {
  name: string
  table_count: number
  owned_by_current_user?: boolean
}

interface TableInfo {
  id: string
  area: string
  status: string
  guests?: number
  opened_at?: string | null
  order_id?: string | null
  default_guests?: number
  owned_by_current_user?: boolean
}

interface TableConfig {
  areas: TableArea[]
  tables: TableInfo[]
}

interface TableRow extends TableInfo {
  key: string
}

interface VoucherDefinition {
  id: number
  name: string
  sale_price: number
  face_value: number
  owned_by_current_user?: boolean
}

interface Props {
  onProductionTicketEnabledChange?: (enabled: boolean) => void
}

interface DragRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  index: number
  moveRow: (from: number, to: number) => void
  onDragMove?: (clientY: number) => void
  onDragEnd?: () => void
}

const DragRow: FC<DragRowProps> = ({ index, moveRow, onDragMove, onDragEnd, className, ...props }) => {
  const [isDragging, setIsDragging] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)

  const computedClass = [
    className,
    'drag-row',
    isDragging ? 'drag-row-source' : '',
    isDragOver && !isDragging ? 'drag-row-target' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <tr
      {...props}
      className={computedClass}
      onDragStart={() => {
        setIsDragging(true)
      }}
      onDrag={(e) => {
        if (e.clientY > 0 && e.clientX > 0) onDragMove?.(e.clientY)
      }}
      onDragEnd={() => {
        setIsDragging(false)
        setIsDragOver(false)
        onDragEnd?.()
      }}
      onDragEnter={(e) => {
        e.preventDefault()
        if (!isDragging) setIsDragOver(true)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsDragOver(false)
        }
      }}
      onDrop={(e) => {
        e.preventDefault()
        setIsDragOver(false)
        const from = Number(e.dataTransfer.getData('text/plain'))
        if (!Number.isNaN(from) && from !== index) {
          moveRow(from, index)
        }
      }}
    />
  )
}

const TRANSPARENT_PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const transparentDragImg = (() => {
  const img = new Image()
  img.src = TRANSPARENT_PIXEL
  return img
})()

interface DragHandleProps {
  index: number
  label: string
  onStartGhost?: (label: string, tr: HTMLTableRowElement | null) => void
  disabled?: boolean
}

const DragHandle: FC<DragHandleProps> = ({ index, label, onStartGhost, disabled = false }) => (
  <span
    className={`drag-handle${disabled ? ' disabled' : ''}`}
    title={disabled ? '访客用户不可操作其他用户创建的数据' : '拖动排序'}
    draggable={!disabled}
    onDragStart={(e) => {
      if (disabled) {
        e.preventDefault()
        return
      }
      e.dataTransfer.setData('text/plain', String(index))
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setDragImage(transparentDragImg, 0, 0)
      const tr = (e.currentTarget as HTMLElement).closest('tr') as HTMLTableRowElement | null
      onStartGhost?.(label, tr)
    }}
  >
    <HolderOutlined />
  </span>
)

const ScopedActionHint: FC<{ disabled: boolean; children: ReactNode }> = ({ disabled, children }) => (
  disabled
    ? <Tooltip title="访客用户不可操作其他用户创建的数据"><span className="guest-disabled-action">{children}</span></Tooltip>
    : <>{children}</>
)

export default function SettingsPage({ onProductionTicketEnabledChange }: Props = {}) {
  const { user, hasPermission } = useAuth()
  const isGuest = user?.data_scope === 'own_created' || Boolean(user?.roles.some(role => role.code === 'guest'))
  const [menu, setMenu] = useState<MenuData>({ categories: [] })
  const initialTab: SettingsTab = hasPermission('menu.view') ? 'category'
    : hasPermission('table_config.view') ? 'area'
      : hasPermission('voucher.view') ? 'voucher'
        : hasPermission('system.production_ticket') ? 'production'
          : hasPermission('user.view') ? 'user'
            : hasPermission('role.view') ? 'role'
              : 'audit'
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab)
  const [addVisible, setAddVisible] = useState(false)
  const [categoryPage, setCategoryPage] = useState(1)
  const [categoryPageSize, setCategoryPageSize] = useState(10)
  const [categoryKeyword, setCategoryKeyword] = useState('')
  const [itemPage, setItemPage] = useState(1)
  const [itemPageSize, setItemPageSize] = useState(10)
  const [itemBatchMode, setItemBatchMode] = useState(false)
  const [selectedItemIds, setSelectedItemIds] = useState<number[]>([])
  const [itemBatchVisible, setItemBatchVisible] = useState(false)
  const [itemBatchSubmitting, setItemBatchSubmitting] = useState(false)
  const [itemBatchForm] = Form.useForm()
  const [tablePage, setTablePage] = useState(1)
  const [tablePageSize, setTablePageSize] = useState(10)
  const [tableKeyword, setTableKeyword] = useState('')
  const [voucherPage, setVoucherPage] = useState(1)
  const [voucherPageSize, setVoucherPageSize] = useState(10)
  const [voucherKeyword, setVoucherKeyword] = useState('')
  const [areaKeyword, setAreaKeyword] = useState('')
  const [itemExporting, setItemExporting] = useState(false)
  const [itemKeyword, setItemKeyword] = useState('')
  const [itemCategoryFilter, setItemCategoryFilter] = useState<string>('all')
  const [categoryForm] = Form.useForm()
  const [itemForm] = Form.useForm()
  const [editItemForm] = Form.useForm()
  const addItemCategory = Form.useWatch('category', itemForm)
  const editItemCategory = Form.useWatch('category', editItemForm)
  const [submitting, setSubmitting] = useState(false)
  const [renamingCategory, setRenamingCategory] = useState<Category | null>(null)
  const [renameInput, setRenameInput] = useState('')
  const [renameCategorySeq, setRenameCategorySeq] = useState<number | null>(1)
  const [renamingSubmit, setRenamingSubmit] = useState(false)
  const [editingItem, setEditingItem] = useState<ItemRow | null>(null)
  const [editItemVisible, setEditItemVisible] = useState(false)
  const [editItemSubmit, setEditItemSubmit] = useState(false)
  const [tableConfig, setTableConfig] = useState<TableConfig>({ areas: [], tables: [] })
  const [areaForm] = Form.useForm()
  const [tableDefForm] = Form.useForm()
  const [editTableForm] = Form.useForm()
  const addTableArea = Form.useWatch('area', tableDefForm)
  const [areaSubmitting, setAreaSubmitting] = useState(false)
  const [tableDefSubmitting, setTableDefSubmitting] = useState(false)
  const [renamingArea, setRenamingArea] = useState<TableArea | null>(null)
  const [renameAreaInput, setRenameAreaInput] = useState('')
  const [renameAreaSeq, setRenameAreaSeq] = useState<number | null>(1)
  const [renameAreaVisible, setRenameAreaVisible] = useState(false)
  const [renameAreaSubmit, setRenameAreaSubmit] = useState(false)
  const [editingTable, setEditingTable] = useState<TableInfo | null>(null)
  const [editTableVisible, setEditTableVisible] = useState(false)
  const [editTableSubmit, setEditTableSubmit] = useState(false)
  const [vouchers, setVouchers] = useState<VoucherDefinition[]>([])
  const [voucherForm] = Form.useForm()
  const [editVoucherForm] = Form.useForm()
  const [editingVoucher, setEditingVoucher] = useState<VoucherDefinition | null>(null)
  const [voucherSubmitting, setVoucherSubmitting] = useState(false)
  const [productionTicketEnabled, setProductionTicketEnabled] = useState(false)
  const [productionSettingSaving, setProductionSettingSaving] = useState(false)
  const ghostRef = useRef<HTMLDivElement>(null)
  const [ghost, setGhost] = useState<{ label: string; x: number; width: number; visible: boolean }>({
    label: '',
    x: 0,
    width: 0,
    visible: false,
  })

  const startGhost = (label: string, tr: HTMLTableRowElement | null) => {
    if (!tr) return
    const rect = tr.getBoundingClientRect()
    setGhost({ label, x: rect.left, width: rect.width, visible: true })
    if (ghostRef.current) {
      ghostRef.current.style.top = `${rect.top + rect.height / 2}px`
    }
  }

  const moveGhost = (clientY: number) => {
    if (ghostRef.current) {
      ghostRef.current.style.top = `${clientY}px`
    }
  }

  const endGhost = () => {
    setGhost(g => ({ ...g, visible: false }))
  }

  const fetchMenu = async () => {
    try {
      const res = await axios.get('/api/menu')
      if (res.data.success) {
        setMenu(res.data.data)
      }
    } catch (e) {
      message.error('获取菜单失败')
    }
  }

  const fetchTableConfig = async () => {
    try {
      const res = await axios.get('/api/table/configuration')
      if (res.data.success) {
        setTableConfig(res.data.data)
      }
    } catch (e) {
      message.error('获取桌台配置失败')
    }
  }

  const fetchVouchers = async () => {
    try {
      const res = await axios.get('/api/vouchers')
      if (res.data.success) setVouchers(res.data.data)
    } catch (e) {
      message.error('获取优惠券配置失败')
    }
  }

  const fetchSystemSettings = async () => {
    try {
      const res = await axios.get('/api/system-settings')
      if (res.data.success) {
        setProductionTicketEnabled(res.data.data.production_ticket_enabled !== false)
      }
    } catch (e) {
      message.error('获取制作单设置失败')
    }
  }

  useEffect(() => {
    if (hasPermission('menu.view')) fetchMenu()
    if (hasPermission('table_config.view')) fetchTableConfig()
    if (hasPermission('voucher.view')) fetchVouchers()
    fetchSystemSettings()
  }, [])

  const updateProductionTicketEnabled = async (enabled: boolean) => {
    setProductionSettingSaving(true)
    try {
      const res = await axios.patch('/api/system-settings', {
        production_ticket_enabled: enabled,
      })
      if (res.data.success) {
        const next = res.data.data.production_ticket_enabled !== false
        setProductionTicketEnabled(next)
        onProductionTicketEnabledChange?.(next)
        message.success(next ? '制作单模式已开启' : '制作单模式已关闭')
      } else {
        message.error(res.data.error || '保存失败')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '保存失败')
    } finally {
      setProductionSettingSaving(false)
    }
  }

  const addCategory = async (values: { name: string; position?: number }) => {
    const name = values.name?.trim()
    if (!name) return
    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = { name }
      if (values.position && values.position >= 1) payload.position = values.position
      const res = await axios.post('/api/menu/category', payload)
      if (res.data.success) {
        categoryForm.resetFields()
        setAddVisible(false)
        await fetchMenu()
      } else {
        message.error(res.data.error || '添加失败')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '添加失败')
    } finally {
      setSubmitting(false)
    }
  }

  const deleteCategory = async (name: string) => {
    try {
      const res = await axios.delete(`/api/menu/category/${encodeURIComponent(name)}`)
      if (res.data.success) {
        fetchMenu()
      } else {
        message.error(res.data.error || '删除失败')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '删除失败')
    }
  }

  const openRenameCategory = (category: Category) => {
    setRenamingCategory(category)
    setRenameInput(category.name)
    const idx = menu.categories.findIndex(c => c.name === category.name)
    setRenameCategorySeq(idx >= 0 ? idx + 1 : 1)
  }

  const submitRenameCategory = async () => {
    if (!renamingCategory) return
    const newName = renameInput.trim()
    if (!newName) {
      message.error('类别名称不能为空')
      return
    }
    const idx = menu.categories.findIndex(c => c.name === renamingCategory.name)
    const currentSeq = idx + 1
    const targetSeq = renameCategorySeq ?? currentSeq
    const seqChanged = targetSeq !== currentSeq && targetSeq >= 1 && targetSeq <= menu.categories.length
    if (newName === renamingCategory.name && !seqChanged) {
      setRenamingCategory(null)
      return
    }
    setRenamingSubmit(true)
    try {
      let effectiveName = renamingCategory.name
      if (newName !== renamingCategory.name) {
        const res = await axios.patch(`/api/menu/category/${encodeURIComponent(renamingCategory.name)}`, { name: newName })
        if (!res.data.success) {
          message.error(res.data.error || '重命名失败')
          return
        }
        effectiveName = newName
        await fetchMenu()
      }
      if (seqChanged) {
        await setCategoryPosition(effectiveName, targetSeq)
      }
      setRenamingCategory(null)
    } catch (e: any) {
      message.error(e?.response?.data?.error || '更新失败')
    } finally {
      setRenamingSubmit(false)
    }
  }

  const setCategoryPosition = async (name: string, position: number) => {
    try {
      const res = await axios.put(
        `/api/menu/category/${encodeURIComponent(name)}/position`,
        { position }
      )
      if (res.data.success) {
        setMenu(res.data.data)
      } else {
        message.error(res.data.error || '排序失败')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '排序失败')
    }
  }

  const handleCategoryDrag = (from: number, to: number) => {
    const dragged = menu.categories[from]
    if (!dragged) return
    setCategoryPosition(dragged.name, to + 1)
  }

  const addItem = async (values: any) => {
    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        category: values.category,
        name: values.name?.trim(),
        price: values.price,
        english_name: values.english_name?.trim() || undefined,
        abv: values.abv?.trim() || undefined,
        description: values.description?.trim() || undefined,
      }
      if (values.position && values.position >= 1) payload.position = values.position
      const res = await axios.post('/api/menu/item', payload)
      if (res.data.success) {
        itemForm.resetFields()
        setAddVisible(false)
        await fetchMenu()
      } else {
        message.error(res.data.error || '添加失败')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '添加失败')
    } finally {
      setSubmitting(false)
    }
  }

  const deleteItem = async (id: number) => {
    try {
      const res = await axios.delete(`/api/menu/item/${id}`)
      if (res.data.success) {
        fetchMenu()
      } else {
        message.error(res.data.error || '删除失败')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '删除失败')
    }
  }

  const openEditItem = (row: ItemRow) => {
    setEditingItem(row)
    const cat = menu.categories.find(c => c.name === row.category)
    const pos = (cat?.items || []).findIndex(i => i.id === row.id) + 1
    editItemForm.setFieldsValue({
      category: row.category,
      seq: pos || 1,
      name: row.name,
      price: row.price,
      sale_status: row.sale_status || 'on_sale',
      english_name: row.english_name || '',
      abv: row.abv || '',
      description: row.description || '',
    })
    setEditItemVisible(true)
  }

  const submitEditItem = async (values: any) => {
    if (!editingItem) return
    setEditItemSubmit(true)
    try {
      const res = await axios.patch(`/api/menu/item/${editingItem.id}`, {
        category: values.category,
        name: values.name?.trim(),
        price: values.price,
        sale_status: values.sale_status,
        english_name: values.english_name?.trim() || '',
        abv: values.abv?.trim() || '',
        description: values.description?.trim() || '',
      })
      if (!res.data.success) {
        message.error(res.data.error || '更新失败')
        return
      }
      const updatedMenu: MenuData = res.data.data
      setMenu(updatedMenu)
      const targetCat = updatedMenu.categories.find(c => c.name === values.category)
      const itemsInCat = targetCat?.items || []
      const currentPos = itemsInCat.findIndex(i => i.id === editingItem.id) + 1
      const desiredSeq = values.seq
      if (
        Number.isFinite(desiredSeq) &&
        desiredSeq >= 1 &&
        desiredSeq <= itemsInCat.length &&
        desiredSeq !== currentPos
      ) {
        await relocateItem(editingItem.id, values.category, desiredSeq)
      }
      setEditItemVisible(false)
      setEditingItem(null)
    } catch (e: any) {
      message.error(e?.response?.data?.error || '更新失败')
    } finally {
      setEditItemSubmit(false)
    }
  }

  const relocateItem = async (itemId: number, category: string, position: number) => {
    try {
      const res = await axios.put(`/api/menu/item/${itemId}/relocate`, { category, position })
      if (res.data.success) {
        setMenu(res.data.data)
      } else {
        message.error(res.data.error || '排序失败')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '排序失败')
    }
  }

  const itemRows: ItemRow[] = menu.categories.flatMap(c =>
    (c.items || []).map(i => ({ ...i, category: c.name, key: `${c.name}-${i.id}` }))
  )

  const filteredItemRows = useMemo(() => {
    const kw = itemKeyword.trim().toLowerCase()
    return itemRows.filter(r => {
      if (itemCategoryFilter !== 'all' && r.category !== itemCategoryFilter) return false
      if (!kw) return true
      return (
        r.name.toLowerCase().includes(kw) ||
        (r.english_name || '').toLowerCase().includes(kw)
      )
    })
  }, [itemRows, itemKeyword, itemCategoryFilter])
  const mutableFilteredItemRows = isGuest
    ? filteredItemRows.filter(item => item.owned_by_current_user)
    : filteredItemRows
  const allFilteredItemsSelected = mutableFilteredItemRows.length > 0 && mutableFilteredItemRows.every(
    item => selectedItemIds.includes(item.id),
  )

  const handleItemDrag = (from: number, to: number) => {
    const dragged = filteredItemRows[from]
    const target = filteredItemRows[to]
    if (!dragged || !target || dragged.id === target.id) return
    if (dragged.category !== target.category) {
      message.warning('类别排序仅支持在同一类别内拖动')
      return
    }
    const siblings = itemRows.filter(r => r.category === target.category)
    const targetPosition = siblings.findIndex(r => r.id === target.id) + 1
    relocateItem(dragged.id, target.category, targetPosition)
  }

  const exportItems = async () => {
    if (!filteredItemRows.length) {
      message.warning('当前筛选结果没有可导出的商品')
      return
    }
    setItemExporting(true)
    try {
      const res = await axios.post('/api/menu/items/export', {
        item_ids: filteredItemRows.map(item => item.id),
      }, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const link = document.createElement('a')
      link.href = url
      link.download = `商品管理-${dayjs().format('YYYYMMDD-HHmmss')}.xlsx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      message.success(`已导出 ${filteredItemRows.length} 件商品`)
    } catch {
      message.error('商品导出失败')
    } finally {
      setItemExporting(false)
    }
  }

  const enterItemBatchMode = () => {
    setSelectedItemIds([])
    setItemBatchMode(true)
  }

  const toggleSelectAllFilteredItems = () => {
    setSelectedItemIds(allFilteredItemsSelected ? [] : mutableFilteredItemRows.map(item => item.id))
  }

  const openItemBatchModal = () => {
    if (!selectedItemIds.length) {
      message.warning('请先选择需要批量修改的商品')
      return
    }
    itemBatchForm.resetFields()
    setItemBatchVisible(true)
  }

  const submitItemBatchUpdate = async (values: {
    category?: string
    price?: number
    sale_status?: MenuItem['sale_status']
    abv?: string
  }) => {
    const payload: Record<string, unknown> = { item_ids: selectedItemIds }
    if (values.category != null) payload.category = values.category
    if (values.price != null) payload.price = values.price
    if (values.sale_status != null) payload.sale_status = values.sale_status
    if (values.abv != null) payload.abv = values.abv.trim()
    if (Object.keys(payload).length === 1) {
      message.warning('请至少选择一项需要批量修改的内容')
      return
    }
    setItemBatchSubmitting(true)
    try {
      const res = await axios.put('/api/menu/items/batch-update', payload)
      if (!res.data.success) throw new Error(res.data.error || '批量修改失败')
      setMenu(res.data.data)
      message.success(`已批量修改 ${res.data.updated_count || selectedItemIds.length} 件商品`)
      setItemBatchVisible(false)
      setItemBatchMode(false)
      setSelectedItemIds([])
    } catch (error: any) {
      message.error(error?.response?.data?.error || error?.message || '批量修改失败')
    } finally {
      setItemBatchSubmitting(false)
    }
  }

  const addArea = async (values: { name: string; position?: number }) => {
    const name = values.name?.trim()
    if (!name) return
    setAreaSubmitting(true)
    try {
      const payload: Record<string, unknown> = { name }
      if (values.position && values.position >= 1) payload.position = values.position
      const res = await axios.post('/api/table/area', payload)
      if (res.data.success) {
        areaForm.resetFields()
        setTableConfig(res.data.data)
        setAddVisible(false)
      } else {
        message.error(res.data.error || '添加失败')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '添加失败')
    } finally {
      setAreaSubmitting(false)
    }
  }

  const deleteArea = async (name: string) => {
    try {
      const res = await axios.delete(`/api/table/area/${encodeURIComponent(name)}`)
      if (res.data.success) {
        setTableConfig(res.data.data)
      } else {
        message.error(res.data.error || '删除失败')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '删除失败')
    }
  }

  const openRenameArea = (area: TableArea) => {
    setRenamingArea(area)
    setRenameAreaInput(area.name)
    const idx = tableConfig.areas.findIndex(a => a.name === area.name)
    setRenameAreaSeq(idx >= 0 ? idx + 1 : 1)
    setRenameAreaVisible(true)
  }

  const submitRenameArea = async () => {
    if (!renamingArea) return
    const newName = renameAreaInput.trim()
    if (!newName) {
      message.error('区域名称不能为空')
      return
    }
    const idx = tableConfig.areas.findIndex(a => a.name === renamingArea.name)
    const currentSeq = idx + 1
    const targetSeq = renameAreaSeq ?? currentSeq
    const seqChanged = targetSeq !== currentSeq && targetSeq >= 1 && targetSeq <= tableConfig.areas.length
    if (newName === renamingArea.name && !seqChanged) {
      setRenameAreaVisible(false)
      return
    }
    setRenameAreaSubmit(true)
    try {
      let effectiveName = renamingArea.name
      if (newName !== renamingArea.name) {
        const res = await axios.patch(`/api/table/area/${encodeURIComponent(renamingArea.name)}`, { name: newName })
        if (!res.data.success) {
          message.error(res.data.error || '重命名失败')
          return
        }
        effectiveName = newName
        setTableConfig(res.data.data)
      }
      if (seqChanged) {
        await setAreaPosition(effectiveName, targetSeq)
      }
      setRenameAreaVisible(false)
      setRenamingArea(null)
    } catch (e: any) {
      message.error(e?.response?.data?.error || '重命名失败')
    } finally {
      setRenameAreaSubmit(false)
    }
  }

  const setAreaPosition = async (name: string, position: number) => {
    try {
      const res = await axios.put(`/api/table/area/${encodeURIComponent(name)}/position`, { position })
      if (res.data.success) {
        setTableConfig(res.data.data)
      } else {
        message.error(res.data.error || '排序失败')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '排序失败')
    }
  }

  const addTableDef = async (values: any) => {
    setTableDefSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        id: values.id?.trim(),
        area: values.area,
        default_guests: values.default_guests ?? 1,
      }
      if (values.position && values.position >= 1) payload.position = values.position
      const res = await axios.post('/api/table/definition', payload)
      if (res.data.success) {
        tableDefForm.resetFields()
        setTableConfig(res.data.data)
        setAddVisible(false)
      } else {
        message.error(res.data.error || '添加失败')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '添加失败')
    } finally {
      setTableDefSubmitting(false)
    }
  }

  const deleteTableDef = async (id: string) => {
    try {
      const res = await axios.delete(`/api/table/definition/${encodeURIComponent(id)}`)
      if (res.data.success) {
        setTableConfig(res.data.data)
      } else {
        message.error(res.data.error || '删除失败')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '删除失败')
    }
  }

  const openEditTable = (row: TableRow) => {
    setEditingTable(row)
    const siblings = tableConfig.tables.filter(t => t.area === row.area)
    const pos = siblings.findIndex(t => t.id === row.id) + 1
    editTableForm.setFieldsValue({
      id: row.id,
      area: row.area,
      seq: pos || 1,
      default_guests: row.default_guests ?? 1,
    })
    setEditTableVisible(true)
  }

  const submitEditTable = async (values: any) => {
    if (!editingTable) return
    setEditTableSubmit(true)
    try {
      const payload: Record<string, any> = {
        default_guests: values.default_guests ?? 1,
      }
      // Only send id/area if table is empty (backend rejects otherwise)
      if (editingTable.status === 'empty') {
        payload.id = values.id?.trim()
        payload.area = values.area
      }
      const res = await axios.patch(`/api/table/definition/${encodeURIComponent(editingTable.id)}`, payload)
      if (!res.data.success) {
        message.error(res.data.error || '更新失败')
        return
      }
      const updatedConfig = res.data.data
      setTableConfig(updatedConfig)
      // Relocate within target area (only allowed when table is empty)
      if (editingTable.status === 'empty') {
        const siblings = updatedConfig.tables.filter((t: TableRow) => t.area === values.area)
        const currentPos = siblings.findIndex((t: TableRow) => t.id === editingTable.id) + 1
        const desiredSeq = values.seq
        if (
          Number.isFinite(desiredSeq) &&
          desiredSeq >= 1 &&
          desiredSeq <= siblings.length &&
          desiredSeq !== currentPos
        ) {
          await relocateTable(editingTable.id, values.area, desiredSeq)
        }
      }
      setEditTableVisible(false)
      setEditingTable(null)
    } catch (e: any) {
      message.error(e?.response?.data?.error || '更新失败')
    } finally {
      setEditTableSubmit(false)
    }
  }

  const relocateTable = async (tableId: string, area: string, position: number) => {
    try {
      const res = await axios.put(`/api/table/definition/${encodeURIComponent(tableId)}/position`, {
        area,
        position,
      })
      if (res.data.success) {
        setTableConfig(res.data.data)
      } else {
        message.error(res.data.error || '排序失败')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '排序失败')
    }
  }

  const tableRows: TableRow[] = tableConfig.tables.map(t => ({ ...t, key: t.id }))
  const [selectedArea, setSelectedArea] = useState<string | null>(null)

  const normalizedCategoryKeyword = categoryKeyword.trim().toLowerCase()
  const filteredCategories = useMemo(
    () => normalizedCategoryKeyword
      ? menu.categories.filter(category => category.name.toLowerCase().includes(normalizedCategoryKeyword))
      : menu.categories,
    [menu.categories, normalizedCategoryKeyword],
  )

  const normalizedAreaKeyword = areaKeyword.trim().toLowerCase()
  const filteredAreas = useMemo(
    () => normalizedAreaKeyword
      ? tableConfig.areas.filter(area => area.name.toLowerCase().includes(normalizedAreaKeyword))
      : tableConfig.areas,
    [tableConfig.areas, normalizedAreaKeyword],
  )

  const normalizedTableKeyword = tableKeyword.trim().toLowerCase()

  const filteredTableRows = useMemo(
    () => tableRows.filter(row => (
      (!selectedArea || row.area === selectedArea)
      && (!normalizedTableKeyword || row.id.toLowerCase().includes(normalizedTableKeyword) || row.area.toLowerCase().includes(normalizedTableKeyword))
    )),
    [tableRows, selectedArea, normalizedTableKeyword]
  )

  const normalizedVoucherKeyword = voucherKeyword.trim().toLowerCase()
  const filteredVouchers = useMemo(
    () => normalizedVoucherKeyword
      ? vouchers.filter(voucher => voucher.name.toLowerCase().includes(normalizedVoucherKeyword))
      : vouchers,
    [vouchers, normalizedVoucherKeyword],
  )

  useEffect(() => {
    if (selectedArea && !tableConfig.areas.find(a => a.name === selectedArea)) {
      setSelectedArea(null)
    }
  }, [tableConfig.areas, selectedArea])

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredCategories.length / categoryPageSize))
    setCategoryPage(p => Math.min(p, maxPage))
  }, [filteredCategories.length, categoryPageSize])

  useEffect(() => setCategoryPage(1), [categoryKeyword])

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredItemRows.length / itemPageSize))
    setItemPage(p => Math.min(p, maxPage))
  }, [filteredItemRows.length, itemPageSize])

  useEffect(() => {
    setItemPage(1)
    setSelectedItemIds([])
  }, [itemKeyword, itemCategoryFilter])

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredTableRows.length / tablePageSize))
    setTablePage(p => Math.min(p, maxPage))
  }, [filteredTableRows.length, tablePageSize])

  useEffect(() => {
    setTablePage(1)
  }, [selectedArea, tableKeyword])

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(filteredVouchers.length / voucherPageSize))
    setVoucherPage(p => Math.min(p, maxPage))
  }, [filteredVouchers.length, voucherPageSize])

  useEffect(() => setVoucherPage(1), [voucherKeyword])

  const pagedCategories = filteredCategories.slice(
    (categoryPage - 1) * categoryPageSize,
    categoryPage * categoryPageSize,
  )
  const pagedItems = filteredItemRows.slice(
    (itemPage - 1) * itemPageSize,
    itemPage * itemPageSize,
  )
  const pagedTables = filteredTableRows.slice(
    (tablePage - 1) * tablePageSize,
    tablePage * tablePageSize,
  )
  const pagedVouchers = filteredVouchers.slice(
    (voucherPage - 1) * voucherPageSize,
    voucherPage * voucherPageSize,
  )

  const handleTableDrag = (from: number, to: number) => {
    const dragged = filteredTableRows[from]
    const target = filteredTableRows[to]
    if (!dragged || !target || dragged.id === target.id) return
    const siblings = tableRows.filter(r => r.area === target.area)
    const targetPosition = siblings.findIndex(r => r.id === target.id) + 1
    relocateTable(dragged.id, target.area, targetPosition)
  }

  const tableStatusLabels: Record<string, string> = {
    empty: '空桌',
    occupied: '使用中',
    pending_cleanup: '待清台',
  }

  const addVoucher = async (values: { name: string; sale_price?: number; face_value: number }) => {
    setVoucherSubmitting(true)
    try {
      const res = await axios.post('/api/vouchers', {
        name: values.name?.trim(),
        sale_price: values.sale_price || 0,
        face_value: values.face_value,
      })
      if (res.data.success) {
        setVouchers(res.data.data)
        voucherForm.resetFields()
        setAddVisible(false)
      } else {
        message.error(res.data.error || '添加失败')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '添加失败')
    } finally {
      setVoucherSubmitting(false)
    }
  }

  const openEditVoucher = (voucher: VoucherDefinition) => {
    setEditingVoucher(voucher)
    editVoucherForm.setFieldsValue(voucher)
  }

  const submitEditVoucher = async (values: { name: string; sale_price?: number; face_value: number }) => {
    if (!editingVoucher) return
    setVoucherSubmitting(true)
    try {
      const res = await axios.patch(`/api/vouchers/${editingVoucher.id}`, {
        name: values.name?.trim(),
        sale_price: values.sale_price || 0,
        face_value: values.face_value,
      })
      if (res.data.success) {
        setVouchers(res.data.data)
        setEditingVoucher(null)
      } else {
        message.error(res.data.error || '保存失败')
      }
    } catch (e: any) {
      message.error(e?.response?.data?.error || '保存失败')
    } finally {
      setVoucherSubmitting(false)
    }
  }

  const deleteVoucher = async (voucherId: number) => {
    try {
      const res = await axios.delete(`/api/vouchers/${voucherId}`)
      if (res.data.success) setVouchers(res.data.data)
      else message.error(res.data.error || '删除失败')
    } catch (e: any) {
      message.error(e?.response?.data?.error || '删除失败')
    }
  }

  const voucherColumns: ColumnsType<VoucherDefinition> = [
    {
      title: '序号',
      width: 90,
      align: 'center',
      render: (_, record) => vouchers.findIndex(voucher => voucher.id === record.id) + 1,
    },
    { title: '优惠券名称', dataIndex: 'name', key: 'name' },
    {
      title: '售价',
      dataIndex: 'sale_price',
      key: 'sale_price',
      width: 150,
      render: (value: number) => value > 0 ? `¥${formatAmount(value)}` : '—',
    },
    {
      title: '抵扣金额',
      dataIndex: 'face_value',
      key: 'face_value',
      width: 150,
      render: (value: number) => `¥${formatAmount(value)}`,
    },
    {
      title: '说明',
      key: 'description',
      render: (_, record) => record.sale_price > 0
        ? `${formatAmount(record.sale_price)} 代 ${formatAmount(record.face_value)}`
        : `抵扣 ${formatAmount(record.face_value)}`,
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_, record) => {
        const locked = isGuest && !record.owned_by_current_user
        return <span className="row-action-group">
          {hasPermission('voucher.edit') && <ScopedActionHint disabled={locked}><Button disabled={locked} type="text" icon={<EditOutlined />} onClick={() => openEditVoucher(record)} /></ScopedActionHint>}
          {hasPermission('voucher.delete') && (locked ? <ScopedActionHint disabled><Button disabled type="text" icon={<DeleteOutlined />} /></ScopedActionHint> : <Popconfirm
            title={`删除优惠券「${record.name}」？`}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => deleteVoucher(record.id)}
          >
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>)}
        </span>
      },
    },
  ]

  const tableDefColumns: ColumnsType<TableRow> = [
    {
      title: '全部序号',
      key: 'seq',
      width: 150,
      align: 'center' as const,
      render: (_, record) => {
        const flatIndex = tableRows.findIndex(r => r.id === record.id)
        return (
          <span className="seq-cell-wrap">
            {hasPermission('table_config.edit') && <DragHandle
              index={flatIndex}
              label={`${record.area} · ${record.id}`}
              onStartGhost={startGhost}
              disabled={isGuest && !record.owned_by_current_user}
            />}
            <span className="seq-value">{flatIndex + 1}</span>
          </span>
        )
      },
    },
    { title: '区域', dataIndex: 'area', key: 'area', width: 100 },
    { title: '桌台号', dataIndex: 'id', key: 'id', width: 110 },
    {
      title: '默认人数',
      dataIndex: 'default_guests',
      key: 'default_guests',
      width: 90,
      align: 'center' as const,
      render: (v?: number) => v ?? 1,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (v: string) => tableStatusLabels[v] || v,
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_, record) => {
        const canDelete = record.status === 'empty'
        const locked = isGuest && !record.owned_by_current_user
        return (
          <span className="row-action-group">
            {hasPermission('table_config.edit') && <ScopedActionHint disabled={locked}><Button
              disabled={locked}
              type="text"
              icon={<EditOutlined />}
              onClick={() => openEditTable(record)}
            /></ScopedActionHint>}
            {hasPermission('table_config.edit') && (locked ? <ScopedActionHint disabled><Button disabled type="text" icon={<DeleteOutlined />} /></ScopedActionHint> : <Popconfirm
              title={`删除桌台「${record.id}」？`}
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true, disabled: !canDelete }}
              onConfirm={() => deleteTableDef(record.id)}
            >
              <Button type="text" danger icon={<DeleteOutlined />} disabled={!canDelete} />
            </Popconfirm>)}
          </span>
        )
      },
    },
  ]

  const categoryColumns: ColumnsType<Category> = [
    {
      title: '全部序号',
      key: 'seq',
      width: 150,
      align: 'center' as const,
      render: (_, record) => {
        const index = menu.categories.findIndex(category => category.name === record.name)
        return (
          <span className="seq-cell-wrap">
            {hasPermission('menu.edit') && <DragHandle index={index} label={record.name} onStartGhost={startGhost} disabled={isGuest && !record.owned_by_current_user} />}
            <span className="seq-value">{index + 1}</span>
          </span>
        )
      },
    },
    { title: '类别名称', dataIndex: 'name', key: 'name' },
    {
      title: '商品数',
      key: 'count',
      width: 80,
      align: 'center' as const,
      render: (_, record) => record.items?.length || 0,
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_, record) => {
        const itemCount = record.items?.length || 0
        const locked = isGuest && !record.owned_by_current_user
        return (
          <span className="row-action-group">
            {hasPermission('menu.edit') && <ScopedActionHint disabled={locked}><Button
              disabled={locked}
              type="text"
              icon={<EditOutlined />}
              onClick={() => openRenameCategory(record)}
            /></ScopedActionHint>}
            {hasPermission('menu.delete') && (locked ? <ScopedActionHint disabled><Button disabled type="text" icon={<DeleteOutlined />} /></ScopedActionHint> : <Popconfirm
              title={`删除类别「${record.name}」？`}
              description={
                itemCount > 0
                  ? `将同时删除该类别下的 ${itemCount} 个商品，删除后无法恢复`
                  : '删除后无法恢复'
              }
              okText="删除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => deleteCategory(record.name)}
            >
              <Button type="text" danger icon={<DeleteOutlined />} />
            </Popconfirm>)}
          </span>
        )
      },
    },
  ]

  const itemColumns: ColumnsType<ItemRow> = [
    {
      title: '全部序号',
      key: 'seq',
      width: 100,
      align: 'center' as const,
      render: (_, record) => {
        const flatIndex = itemRows.findIndex(r => r.id === record.id)
        return <span className="seq-value">{flatIndex + 1}</span>
      },
    },
    { title: '类别', dataIndex: 'category', key: 'category', width: 100 },
    {
      title: '类别排序',
      key: 'category_position',
      width: 100,
      align: 'center',
      render: (_, record) => {
        const categoryItems = menu.categories.find(category => category.name === record.category)?.items || []
        const position = categoryItems.findIndex(item => item.id === record.id) + 1
        return (
          <span className="seq-cell-wrap">
            {hasPermission('menu.edit') && <DragHandle
              index={filteredItemRows.findIndex(item => item.id === record.id)}
              label={`${record.category} · ${record.name}`}
              onStartGhost={startGhost}
              disabled={isGuest && !record.owned_by_current_user}
            />}
            <span className="seq-value">{position}</span>
          </span>
        )
      },
    },
    { title: '中文名', dataIndex: 'name', key: 'name' },
    {
      title: '英文名',
      dataIndex: 'english_name',
      key: 'english_name',
      render: (v?: string) => v || '—',
    },
    {
      title: '价格',
      dataIndex: 'price',
      key: 'price',
      width: 80,
      render: (v: number) => `¥${formatAmount(v)}`,
    },
    {
      title: '售卖状态',
      dataIndex: 'sale_status',
      key: 'sale_status',
      width: 100,
      align: 'center',
      render: (status?: MenuItem['sale_status']) => status === 'off_sale'
        ? <Tag color="default">已下架</Tag>
        : <Tag color="green">在售</Tag>,
    },
    {
      title: 'ABV',
      dataIndex: 'abv',
      key: 'abv',
      width: 80,
      render: (v?: string) => v || '—',
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_, record) => {
        const locked = isGuest && !record.owned_by_current_user
        return <span className="row-action-group">
          {hasPermission('menu.edit') && <ScopedActionHint disabled={locked}><Button
            disabled={locked}
            type="text"
            icon={<EditOutlined />}
            onClick={() => openEditItem(record)}
          /></ScopedActionHint>}
          {hasPermission('menu.delete') && (locked ? <ScopedActionHint disabled><Button disabled type="text" icon={<DeleteOutlined />} /></ScopedActionHint> : <Popconfirm
            title={`删除商品「${record.name}」？`}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => deleteItem(record.id)}
          >
            <Button type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>)}
        </span>
      },
    },
  ]

  const openAddModal = () => {
    if (activeTab === 'voucher') {
      voucherForm.resetFields()
      voucherForm.setFieldsValue({ sale_price: 0 })
    } else if (activeTab === 'area') {
      areaForm.resetFields()
      areaForm.setFieldsValue({ position: tableConfig.areas.length + 1 })
    } else if (activeTab === 'table') {
      tableDefForm.resetFields()
      const defaultArea = selectedArea || undefined
      const defaultPosition = defaultArea
        ? tableRows.filter(row => row.area === defaultArea).length + 1
        : undefined
      tableDefForm.setFieldsValue({
        default_guests: 1,
        area: defaultArea,
        position: defaultPosition,
      })
    } else if (activeTab === 'item') {
      itemForm.resetFields()
      const defaultCategory = itemCategoryFilter !== 'all' ? itemCategoryFilter : undefined
      const defaultPosition = defaultCategory
        ? itemRows.filter(row => row.category === defaultCategory).length + 1
        : undefined
      itemForm.setFieldsValue({
        category: defaultCategory,
        position: defaultPosition,
      })
    } else {
      categoryForm.resetFields()
      categoryForm.setFieldsValue({ position: menu.categories.length + 1 })
    }
    setAddVisible(true)
  }

  const addModalTitle = () => TAB_META[activeTab].addLabel

  const settingsTabs = [
    { key: 'category' as SettingsTab, label: '类别管理', permission: 'menu.view' },
    { key: 'item' as SettingsTab, label: '商品管理', permission: 'menu.view' },
    { key: 'area' as SettingsTab, label: '区域管理', permission: 'table_config.view' },
    { key: 'table' as SettingsTab, label: '桌台管理', permission: 'table_config.view' },
    { key: 'voucher' as SettingsTab, label: '优惠券管理', permission: 'voucher.view' },
    { key: 'production' as SettingsTab, label: '制作单管理', permission: 'system.production_ticket' },
    { key: 'user' as SettingsTab, label: '用户管理', permission: 'user.view' },
    { key: 'role' as SettingsTab, label: '角色权限', permission: 'role.view' },
    { key: 'audit' as SettingsTab, label: '系统日志', permission: 'audit.view' },
  ].filter(tab => hasPermission(tab.permission))

  useEffect(() => {
    if (settingsTabs.length && !settingsTabs.some(tab => tab.key === activeTab)) {
      setActiveTab(settingsTabs[0].key)
    }
  }, [activeTab, settingsTabs.map(tab => tab.key).join('|')])

  return (
    <div className="settings-page">
      <div className="settings-header">
        <div className="settings-tabs">
          <Tabs
            activeKey={activeTab}
            onChange={(k) => setActiveTab(k as SettingsTab)}
            items={settingsTabs.map(tab => ({ key: tab.key, label: tab.label }))}
          />
        </div>
      </div>

      <div className={`settings-body${['category', 'item', 'area', 'table', 'voucher', 'user', 'role', 'audit'].includes(activeTab) ? ' settings-body-table' : ''}`}>
        {activeTab === 'category' && (
          <>
            <div className="item-filter-bar settings-management-toolbar">
              <div className="item-filter-left">
                <Input.Search
                  className="item-search"
                  placeholder="搜索类别名称"
                  allowClear
                  enterButton="搜索"
                  value={categoryKeyword}
                  onChange={event => setCategoryKeyword(event.target.value)}
                />
              </div>
              {hasPermission('menu.create') && <div className="item-filter-actions">
                <Button type="primary" className="item-batch-button" icon={<PlusOutlined />} onClick={openAddModal}>添加类别</Button>
              </div>}
            </div>
            <SettingsTableFrame
              total={filteredCategories.length}
              unit="个类别"
              page={categoryPage}
              pageSize={categoryPageSize}
              onPageChange={setCategoryPage}
              onPageSizeChange={size => {
                setCategoryPageSize(size)
                setCategoryPage(1)
              }}
            >
              {bodyHeight => (
                <AntTable
                  className="pos-table settings-data-table"
                  rowKey="name"
                  size="small"
                  columns={categoryColumns}
                  dataSource={pagedCategories}
                  scroll={{ y: bodyHeight }}
                  pagination={false}
                  components={{ body: { row: DragRow } }}
                  onRow={record => ({
                    index: menu.categories.findIndex(category => category.name === record.name),
                    moveRow: handleCategoryDrag,
                    onDragMove: moveGhost,
                    onDragEnd: endGhost,
                  } as any)}
                />
              )}
            </SettingsTableFrame>
          </>
        )}

        {activeTab === 'item' && (
          <>
            <div className="item-filter-bar">
              <div className="item-filter-left">
                <Input.Search
                  placeholder="搜索商品中文名 / 英文名"
                  allowClear
                  enterButton="搜索"
                  value={itemKeyword}
                  onChange={e => setItemKeyword(e.target.value)}
                  className="item-search"
                />
                <Select
                  value={itemCategoryFilter}
                  onChange={setItemCategoryFilter}
                  className="item-category-select"
                  options={[
                    { value: 'all', label: '全部类别' },
                    ...menu.categories.map(c => ({ value: c.name, label: c.name })),
                  ]}
                />
              </div>
              <div className="item-filter-actions">
                {hasPermission('menu.batch') && (!itemBatchMode ? (
                  <Button className="item-batch-button" onClick={enterItemBatchMode}>批量操作</Button>
                ) : (
                  <div className="item-batch-actions">
                  <Button
                    type="primary"
                    className="item-batch-button"
                    disabled={!selectedItemIds.length}
                    onClick={openItemBatchModal}
                  >
                    批量修改{selectedItemIds.length ? `（${selectedItemIds.length}）` : ''}
                  </Button>
                  <Button className="item-batch-button" onClick={() => {
                    setItemBatchMode(false)
                    setSelectedItemIds([])
                  }}>退出</Button>
                  </div>
                ))}
                {hasPermission('menu.export') && <Button
                  className="item-batch-button item-export-button"
                  icon={<DownloadOutlined />}
                  loading={itemExporting}
                  onClick={exportItems}
                >
                  导出数据
                </Button>}
                {hasPermission('menu.create') && <Button
                  type="primary"
                  className="item-batch-button"
                  icon={<PlusOutlined />}
                  onClick={openAddModal}
                >
                  添加商品
                </Button>}
              </div>
            </div>
            <SettingsTableFrame
              total={filteredItemRows.length}
              unit="件商品"
              page={itemPage}
              pageSize={itemPageSize}
              onPageChange={setItemPage}
              onPageSizeChange={size => {
                setItemPageSize(size)
                setItemPage(1)
              }}
            >
              {bodyHeight => (
                <AntTable
                  className={`pos-table settings-data-table${itemBatchMode ? ' item-table-batch-mode' : ''}`}
                  rowKey="id"
                  size="small"
                  columns={itemColumns}
                  dataSource={pagedItems}
                  scroll={{ x: 940, y: bodyHeight }}
                  components={{ body: { row: DragRow } }}
                  pagination={false}
                  rowSelection={itemBatchMode ? {
                    selectedRowKeys: selectedItemIds,
                    preserveSelectedRowKeys: true,
                    hideSelectAll: true,
                    columnTitle: (
                      <button
                        type="button"
                        className="item-select-all-button"
                        disabled={!mutableFilteredItemRows.length}
                        onClick={event => {
                          event.stopPropagation()
                          toggleSelectAllFilteredItems()
                        }}
                      >{allFilteredItemsSelected ? '取消' : '全选'}</button>
                    ),
                    onChange: keys => setSelectedItemIds(keys.map(Number)),
                    getCheckboxProps: record => ({
                      disabled: isGuest && !record.owned_by_current_user,
                      title: isGuest && !record.owned_by_current_user ? '访客用户不可操作其他用户创建的数据' : undefined,
                    }),
                    columnWidth: 64,
                  } : undefined}
                  onRow={record => ({
                    index: filteredItemRows.findIndex(item => item.id === record.id),
                    moveRow: handleItemDrag,
                    onDragMove: moveGhost,
                    onDragEnd: endGhost,
                  } as any)}
                />
              )}
            </SettingsTableFrame>
          </>
        )}

        {activeTab === 'area' && (
          <div className="area-management-wrap">
            <div className="item-filter-bar settings-management-toolbar">
              <div className="item-filter-left">
                <Input.Search className="item-search" placeholder="搜索区域名称" allowClear enterButton="搜索" value={areaKeyword} onChange={event => setAreaKeyword(event.target.value)} />
              </div>
              {hasPermission('table_config.edit') && <div className="item-filter-actions">
                <Button type="primary" className="item-batch-button" icon={<PlusOutlined />} onClick={openAddModal}>添加区域</Button>
              </div>}
            </div>
            <div className="area-tile-grid">
            {filteredAreas.length === 0 ? (
              <div className="area-tile-empty">{tableConfig.areas.length ? '没有匹配的区域' : '暂无区域，点击“添加区域”创建'}</div>
            ) : filteredAreas.map((area) => {
              const index = tableConfig.areas.findIndex(item => item.name === area.name)
              const locked = isGuest && !area.owned_by_current_user
              return (
              <div
                key={area.name}
                className="area-tile"
              >
                <div className="area-tile-head">
                  <span className="area-tile-seq">
                    <span className="seq-value">{index + 1}</span>
                  </span>
                  {hasPermission('table_config.edit') && <div className="area-tile-actions">
                    <ScopedActionHint disabled={locked}><Button
                      disabled={locked}
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => openRenameArea(area)}
                    /></ScopedActionHint>
                    {locked ? <ScopedActionHint disabled><Button disabled type="text" size="small" icon={<DeleteOutlined />} /></ScopedActionHint> : <Popconfirm
                      title={`删除区域「${area.name}」？`}
                      description={
                        area.table_count > 0
                          ? `将同时删除该区域下的 ${area.table_count} 个桌台`
                          : '删除后无法恢复'
                      }
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => deleteArea(area.name)}
                    >
                      <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>}
                  </div>}
                </div>
                <div className="area-tile-name">{area.name}</div>
                <div className="area-tile-count">
                  <span className="count-num">{area.table_count}</span>
                  <span className="count-label">个桌台</span>
                </div>
              </div>
              )
            })}
            </div>
          </div>
        )}

        {activeTab === 'table' && (
          <div className="table-mgmt-wrap">
            <div className="table-mgmt-filter">
              <Input.Search className="management-search" placeholder="搜索桌台号 / 区域" allowClear enterButton="搜索" value={tableKeyword} onChange={event => setTableKeyword(event.target.value)} />
              <Select
                value={selectedArea ?? '__all__'}
                onChange={(v) => setSelectedArea(v === '__all__' ? null : v)}
                style={{ width: 200 }}
                options={[
                  { label: '全部区域', value: '__all__' },
                  ...tableConfig.areas.map(a => ({ label: a.name, value: a.name })),
                ]}
              />
              {hasPermission('table_config.edit') && <Button type="primary" className="item-batch-button management-add-button" icon={<PlusOutlined />} onClick={openAddModal}>添加桌台</Button>}
            </div>
            <SettingsTableFrame
              total={filteredTableRows.length}
              unit="个桌台"
              page={tablePage}
              pageSize={tablePageSize}
              onPageChange={setTablePage}
              onPageSizeChange={size => {
                setTablePageSize(size)
                setTablePage(1)
              }}
            >
              {bodyHeight => (
                <AntTable
                  className="pos-table compact-management-table settings-data-table"
                  rowKey="id"
                  size="small"
                  columns={tableDefColumns}
                  dataSource={pagedTables}
                  scroll={{ y: bodyHeight }}
                  components={{ body: { row: DragRow } }}
                  pagination={false}
                  onRow={(record) => ({
                    index: filteredTableRows.findIndex(r => r.id === record.id),
                    moveRow: handleTableDrag,
                    onDragMove: moveGhost,
                    onDragEnd: endGhost,
                  } as any)}
                />
              )}
            </SettingsTableFrame>
          </div>
        )}

        {activeTab === 'voucher' && (
          <>
            <div className="item-filter-bar settings-management-toolbar">
              <div className="item-filter-left">
                <Input.Search className="item-search" placeholder="搜索优惠券名称" allowClear enterButton="搜索" value={voucherKeyword} onChange={event => setVoucherKeyword(event.target.value)} />
              </div>
              {hasPermission('voucher.create') && <div className="item-filter-actions">
                <Button type="primary" className="item-batch-button" icon={<PlusOutlined />} onClick={openAddModal}>添加优惠券</Button>
              </div>}
            </div>
            <SettingsTableFrame
              total={filteredVouchers.length}
              unit="张优惠券"
              page={voucherPage}
              pageSize={voucherPageSize}
              onPageChange={setVoucherPage}
              onPageSizeChange={size => {
                setVoucherPageSize(size)
                setVoucherPage(1)
              }}
            >
              {bodyHeight => (
                <AntTable
                  className="pos-table settings-data-table"
                  rowKey="id"
                  size="small"
                  columns={voucherColumns}
                  dataSource={pagedVouchers}
                  scroll={{ y: bodyHeight }}
                  pagination={false}
                  locale={{ emptyText: '暂无匹配的优惠券' }}
                />
              )}
            </SettingsTableFrame>
          </>
        )}

        {activeTab === 'production' && (
          <div className="production-setting-card">
            <div className="production-setting-copy">
              <strong>制作单模式</strong>
              <span>
                开启后，下单和加菜会生成制作单，并显示桌台页制作单面板、补打制作单及制作单记录。
              </span>
            </div>
            <Tooltip title={isGuest ? '访客用户不可修改系统级设置' : undefined}>
              <span className={isGuest ? 'guest-disabled-action' : undefined}>
                <Switch
                  checked={productionTicketEnabled}
                  loading={productionSettingSaving}
                  disabled={isGuest}
                  checkedChildren="开启"
                  unCheckedChildren="关闭"
                  onChange={updateProductionTicketEnabled}
                />
              </span>
            </Tooltip>
          </div>
        )}

        {activeTab === 'user' && <UserManagementPanel />}

        {activeTab === 'role' && <RoleManagementPanel />}

        {activeTab === 'audit' && <SystemLogPanel />}
      </div>

      <Modal
        title={addModalTitle()}
        open={addVisible}
        onCancel={() => setAddVisible(false)}
        footer={null}
        destroyOnClose
        width={activeTab === 'category' || activeTab === 'voucher' ? 420 : 560}
      >
        {activeTab === 'category' && (
          <Form form={categoryForm} layout="vertical" onFinish={addCategory}>
            <Form.Item
              label="类别名称"
              name="name"
              rules={[{ required: true, message: '请输入类别名称' }]}
            >
              <Input placeholder="如：精酿啤酒" allowClear autoFocus onPressEnter={() => categoryForm.submit()} />
            </Form.Item>
            <Form.Item label="序号（可选）" name="position" extra={`留空将追加到末尾（当前共 ${menu.categories.length} 个类别）`}>
              <StepperInput
                min={1}
                max={menu.categories.length + 1}
                placeholder={`默认 ${menu.categories.length + 1}`}
                style={{ width: '100%' }}
              />
            </Form.Item>
            <div className="settings-modal-footer">
              <Button onClick={() => setAddVisible(false)}>取消</Button>
              <Button type="primary" htmlType="submit" loading={submitting} icon={<PlusOutlined />}>
                添加
              </Button>
            </div>
          </Form>
        )}

        {activeTab === 'item' && (
          <Form form={itemForm} layout="vertical" onFinish={addItem}>
            <Row gutter={16} className="settings-form-grid">
              <Col span={12}>
                <Form.Item
                  label="类别"
                  name="category"
                  rules={[{ required: true, message: '请选择类别' }]}
                >
                  <Select
                    placeholder="选择类别"
                    options={menu.categories.map(c => ({ label: c.name, value: c.name }))}
                    onChange={(category) => {
                      const defaultPosition = itemRows.filter(row => row.category === category).length + 1
                      itemForm.setFieldValue('position', defaultPosition)
                    }}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="序号（类别内，可选）"
                  name="position"
                  extra="留空追加到末尾"
                >
                  <StepperInput
                    min={1}
                    max={Math.max(1, (menu.categories.find(c => c.name === addItemCategory)?.items.length || 0) + 1)}
                    placeholder="选择类别后显示默认序号"
                    disabled={!addItemCategory}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="价格 (¥)"
                  name="price"
                  rules={[{ required: true, message: '请输入价格' }]}
                >
                  <StepperInput min={0} step={1} precision={2} style={{ width: '100%' }} placeholder="如 88.00" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="中文名"
                  name="name"
                  rules={[{ required: true, message: '请输入中文名' }]}
                >
                  <Input placeholder="如：老黎饭店" allowClear />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="英文名" name="english_name">
                  <Input placeholder="可选" allowClear />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="ABV" name="abv">
                  <Input placeholder="可选，如 18%" allowClear />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item label="描述" name="description">
                  <Input placeholder="可选" allowClear />
                </Form.Item>
              </Col>
            </Row>
            <div className="settings-modal-footer">
              <Button onClick={() => setAddVisible(false)}>取消</Button>
              <Button type="primary" htmlType="submit" loading={submitting} icon={<PlusOutlined />}>
                添加商品
              </Button>
            </div>
          </Form>
        )}

        {activeTab === 'area' && (
          <Form form={areaForm} layout="vertical" onFinish={addArea}>
            <Form.Item
              label="区域名称"
              name="name"
              rules={[{ required: true, message: '请输入区域名称' }]}
            >
              <Input placeholder="如：包厢区" allowClear autoFocus onPressEnter={() => areaForm.submit()} />
            </Form.Item>
            <Form.Item label="序号（可选）" name="position" extra={`留空将追加到末尾（当前共 ${tableConfig.areas.length} 个区域）`}>
              <StepperInput
                min={1}
                max={tableConfig.areas.length + 1}
                placeholder={`默认 ${tableConfig.areas.length + 1}`}
                style={{ width: '100%' }}
              />
            </Form.Item>
            <div className="settings-modal-footer">
              <Button onClick={() => setAddVisible(false)}>取消</Button>
              <Button type="primary" htmlType="submit" loading={areaSubmitting} icon={<PlusOutlined />}>
                添加区域
              </Button>
            </div>
          </Form>
        )}

        {activeTab === 'table' && (
          <Form form={tableDefForm} layout="vertical" onFinish={addTableDef} initialValues={{ default_guests: 1 }}>
            <Row gutter={16} className="settings-form-grid settings-table-form-grid">
              <Col span={12}>
                <Form.Item
                  label="所属区域"
                  name="area"
                  rules={[{ required: true, message: '请选择区域' }]}
                >
                  <Select
                    placeholder="选择区域"
                    options={tableConfig.areas.map(a => ({ label: a.name, value: a.name }))}
                    onChange={(area) => {
                      const defaultPosition = tableRows.filter(row => row.area === area).length + 1
                      tableDefForm.setFieldValue('position', defaultPosition)
                    }}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="桌台号"
                  name="id"
                  rules={[{ required: true, message: '请输入桌台号' }]}
                >
                  <Input placeholder="如 A1、B2" allowClear />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="序号（区域内，可选）"
                  name="position"
                  extra="留空追加到末尾"
                >
                  <StepperInput
                    min={1}
                    max={Math.max(1, tableRows.filter(row => row.area === addTableArea).length + 1)}
                    placeholder="选择区域后显示默认序号"
                    disabled={!addTableArea}
                    style={{ width: '100%' }}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="默认人数"
                  name="default_guests"
                  rules={[{ required: true, message: '请输入默认人数' }]}
                >
                  <StepperInput min={1} max={50} step={1} placeholder="如 4" style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
            <div className="settings-modal-footer">
              <Button onClick={() => setAddVisible(false)}>取消</Button>
              <Button type="primary" htmlType="submit" loading={tableDefSubmitting} icon={<PlusOutlined />}>
                添加桌台
              </Button>
            </div>
          </Form>
        )}

        {activeTab === 'voucher' && (
          <Form form={voucherForm} layout="vertical" onFinish={addVoucher}>
            <Form.Item
              label="优惠券名称"
              name="name"
              rules={[{ required: true, message: '请输入优惠券名称' }]}
            >
              <Input placeholder="如：90代100、88抵扣" allowClear autoFocus />
            </Form.Item>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label="售价 (¥)" name="sale_price" extra="无需售价可填写 0">
                  <StepperInput min={0} step={1} precision={2} style={{ width: '100%' }} placeholder="如 90.00" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="抵扣金额 (¥)"
                  name="face_value"
                  rules={[{ required: true, message: '请输入抵扣金额' }]}
                >
                  <StepperInput min={0.01} step={1} precision={2} style={{ width: '100%' }} placeholder="如 100.00" />
                </Form.Item>
              </Col>
            </Row>
            <div className="settings-modal-footer">
              <Button onClick={() => setAddVisible(false)}>取消</Button>
              <Button type="primary" htmlType="submit" loading={voucherSubmitting} icon={<PlusOutlined />}>
                添加优惠券
              </Button>
            </div>
          </Form>
        )}
      </Modal>

      <Modal
        title={`批量修改商品 · 已选择 ${selectedItemIds.length} 件`}
        open={itemBatchVisible}
        onCancel={() => setItemBatchVisible(false)}
        onOk={() => itemBatchForm.submit()}
        confirmLoading={itemBatchSubmitting}
        okText="确认修改"
        cancelText="取消"
        width={600}
        destroyOnClose
      >
        <div className="item-batch-modal-hint">未选择的字段将保持原值不变。</div>
        <Form form={itemBatchForm} layout="vertical" onFinish={submitItemBatchUpdate}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="变更类别" name="category">
                <Select
                  allowClear
                  placeholder="不修改类别"
                  options={menu.categories.map(category => ({ label: category.name, value: category.name }))}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="统一价格" name="price">
                <StepperInput
                  min={0}
                  precision={2}
                  step={1}
                  placeholder="不修改价格"
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="售卖状态" name="sale_status">
                <Select
                  allowClear
                  placeholder="不修改状态"
                  options={[
                    { label: '在售', value: 'on_sale' },
                    { label: '已下架', value: 'off_sale' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="ABV" name="abv">
                <Input
                  allowClear
                  placeholder="不修改，如 18%"
                />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      <Modal
        title={editingVoucher ? `编辑优惠券 · ${editingVoucher.name}` : '编辑优惠券'}
        open={editingVoucher !== null}
        onCancel={() => setEditingVoucher(null)}
        footer={null}
        width={420}
        destroyOnClose
      >
        <Form form={editVoucherForm} layout="vertical" onFinish={submitEditVoucher}>
          <Form.Item
            label="优惠券名称"
            name="name"
            rules={[{ required: true, message: '请输入优惠券名称' }]}
          >
            <Input allowClear autoFocus />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="售价 (¥)" name="sale_price">
                <StepperInput min={0} step={1} precision={2} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="抵扣金额 (¥)"
                name="face_value"
                rules={[{ required: true, message: '请输入抵扣金额' }]}
              >
                <StepperInput min={0.01} step={1} precision={2} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <div className="settings-modal-footer">
            <Button onClick={() => setEditingVoucher(null)}>取消</Button>
            <Button type="primary" htmlType="submit" loading={voucherSubmitting}>保存</Button>
          </div>
        </Form>
      </Modal>

      <Modal
        title={renamingCategory ? `编辑类别 · ${renamingCategory.name}` : ''}
        open={renamingCategory !== null}
        onCancel={() => setRenamingCategory(null)}
        onOk={submitRenameCategory}
        confirmLoading={renamingSubmit}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <div className="rename-form">
          <div className="rename-form-row">
            <label className="rename-form-label">类别名称</label>
            <Input
              value={renameInput}
              onChange={e => setRenameInput(e.target.value)}
              placeholder="新的类别名称"
              allowClear
              maxLength={30}
              onPressEnter={submitRenameCategory}
              autoFocus
            />
          </div>
          <div className="rename-form-row">
            <label className="rename-form-label">序号</label>
            <StepperInput
              value={renameCategorySeq}
              onChange={(v) => setRenameCategorySeq(v)}
              min={1}
              max={menu.categories.length}
              placeholder={`1 ~ ${menu.categories.length}`}
              style={{ width: '100%' }}
            />
          </div>
        </div>
      </Modal>

      <div
        ref={ghostRef}
        className={`drag-ghost${ghost.visible ? ' visible' : ''}`}
        style={{ left: ghost.x, width: ghost.width }}
        aria-hidden
      >
        <HolderOutlined className="drag-ghost-handle" />
        <span className="drag-ghost-label">{ghost.label}</span>
      </div>

      <Modal
        title={renamingArea ? `编辑区域 · ${renamingArea.name}` : ''}
        open={renameAreaVisible}
        onCancel={() => {
          setRenameAreaVisible(false)
          setRenamingArea(null)
        }}
        onOk={submitRenameArea}
        confirmLoading={renameAreaSubmit}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <div className="rename-form">
          <div className="rename-form-row">
            <label className="rename-form-label">区域名称</label>
            <Input
              value={renameAreaInput}
              onChange={e => setRenameAreaInput(e.target.value)}
              placeholder="新的区域名称"
              allowClear
              maxLength={30}
              onPressEnter={submitRenameArea}
              autoFocus
            />
          </div>
          <div className="rename-form-row">
            <label className="rename-form-label">序号</label>
            <StepperInput
              value={renameAreaSeq}
              onChange={(v) => setRenameAreaSeq(v)}
              min={1}
              max={tableConfig.areas.length}
              placeholder={`1 ~ ${tableConfig.areas.length}`}
              style={{ width: '100%' }}
            />
          </div>
        </div>
      </Modal>

      <Modal
        title={editingTable ? `编辑桌台 · ${editingTable.id}` : ''}
        open={editTableVisible}
        onCancel={() => {
          setEditTableVisible(false)
          setEditingTable(null)
        }}
        onOk={() => editTableForm.submit()}
        confirmLoading={editTableSubmit}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={editTableForm} layout="vertical" onFinish={submitEditTable}>
          <Row gutter={16} className="settings-form-grid settings-table-form-grid">
            <Col span={12}>
              <Form.Item
                label="所属区域"
                name="area"
                rules={[{ required: true, message: '请选择区域' }]}
              >
                <Select
                  placeholder="选择区域"
                  options={tableConfig.areas.map(a => ({ label: a.name, value: a.name }))}
                  disabled={editingTable?.status !== 'empty'}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="桌台号"
                name="id"
                rules={[{ required: true, message: '请输入桌台号' }]}
              >
                <Input placeholder="如 A1" allowClear disabled={editingTable?.status !== 'empty'} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="序号 (区域内)"
                name="seq"
                rules={[{ required: true, message: '请输入序号' }]}
              >
                <StepperInput min={1} step={1} placeholder="如 1" disabled={editingTable?.status !== 'empty'} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="默认人数"
                name="default_guests"
                rules={[{ required: true, message: '请输入默认人数' }]}
              >
                <StepperInput min={1} max={50} step={1} placeholder="如 4" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          {editingTable?.status !== 'empty' && (
            <div style={{ marginTop: -8, color: '#999', fontSize: 12 }}>
              桌台使用中，仅可修改默认人数；编号、区域与序号需在空桌状态下修改
            </div>
          )}
        </Form>
      </Modal>

      <Modal
        title={editingItem ? `编辑商品 · ${editingItem.name}` : ''}
        open={editItemVisible}
        onCancel={() => {
          setEditItemVisible(false)
          setEditingItem(null)
        }}
        onOk={() => editItemForm.submit()}
        confirmLoading={editItemSubmit}
        okText="保存"
        cancelText="取消"
        destroyOnClose
        width={680}
      >
        <Form form={editItemForm} layout="vertical" onFinish={submitEditItem}>
          <Row gutter={16} className="settings-form-grid">
            <Col span={12}>
              <Form.Item
                label="类别"
                name="category"
                rules={[{ required: true, message: '请选择类别' }]}
              >
                <Select
                  placeholder="选择类别"
                  options={menu.categories.map(c => ({ label: c.name, value: c.name }))}
                  onChange={category => {
                    const itemCount = menu.categories.find(itemCategory => itemCategory.name === category)?.items.length || 0
                    const nextPosition = itemCount + (editingItem?.category === category ? 0 : 1)
                    editItemForm.setFieldValue('seq', Math.max(1, nextPosition))
                  }}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="类别排序（类别内）"
                name="seq"
                rules={[{ required: true, message: '请输入序号' }]}
              >
                <StepperInput
                  min={1}
                  max={Math.max(
                    1,
                    (menu.categories.find(category => category.name === editItemCategory)?.items.length || 0)
                      + (editingItem && editingItem.category !== editItemCategory ? 1 : 0),
                  )}
                  step={1}
                  placeholder="如 1"
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="售卖状态"
                name="sale_status"
                rules={[{ required: true, message: '请选择售卖状态' }]}
              >
                <Select
                  options={[
                    { label: '在售', value: 'on_sale' },
                    { label: '已下架', value: 'off_sale' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="价格 (¥)"
                name="price"
                rules={[{ required: true, message: '请输入价格' }]}
              >
                <StepperInput min={0} step={1} precision={2} style={{ width: '100%' }} placeholder="如 88.00" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="中文名"
                name="name"
                rules={[{ required: true, message: '请输入中文名' }]}
              >
                <Input placeholder="商品中文名" allowClear />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="英文名" name="english_name">
                <Input placeholder="可选" allowClear />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="ABV" name="abv">
                <Input placeholder="可选，如 18%" allowClear />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="描述" name="description">
                <Input placeholder="可选" allowClear />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  )
}
