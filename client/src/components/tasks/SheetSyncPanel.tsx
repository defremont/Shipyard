import { useState, useCallback } from 'react'
import { Sheet, Download, Upload, Settings2, Loader2, CheckCircle2, XCircle, Unplug, ChevronDown, ChevronUp, Copy, Check, Paintbrush } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSyncConfig, useSyncPush, useSyncPull, useSyncTest, useSyncSetup, type SyncConfig } from '@/hooks/useSheetSync'
import type { Task } from '@/hooks/useTasks'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'

const APPS_SCRIPT_TEMPLATE = `// Shipyard Sync v2 — Two-sheet system
// "Data" sheet: raw synced data (auto-managed)
// "Dashboard" sheet: formatted view (click "Format Sheet" in Shipyard)
//
// Deploy > New deployment > Web App
// Execute as: Me | Access: Anyone

var DATA_SHEET = 'Data';
var DASH_SHEET = 'Dashboard';
var HEADERS = ['id','title','description','priority','status','prompt','updatedAt'];

function getDataSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(DATA_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(DATA_SHEET);
    sheet.getRange(1,1,1,HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  }
  return sheet;
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'read';
  if (action === 'ping') {
    var s = getDataSheet();
    return resp({ ok: true, rows: Math.max(0, s.getLastRow()-1) });
  }
  if (action === 'setup') return setupDashboard();

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(DATA_SHEET) || ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return resp({ tasks: [] });

  var headers = data[0].map(function(h){return String(h).toLowerCase().trim();});
  var tasks = [];
  for (var i=1; i<data.length; i++) {
    var row = data[i];
    if (!row.some(function(c){return String(c).trim();})) continue;
    var task = {};
    headers.forEach(function(h,idx){task[h]=String(row[idx]||'');});
    if (task.title) tasks.push(task);
  }
  return resp({ tasks: tasks });
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var tasks = payload.tasks || [];
    var sheet = getDataSheet();
    var allRows = [HEADERS];
    for (var i=0; i<tasks.length; i++) {
      var t = tasks[i];
      allRows.push(HEADERS.map(function(h){return t[h]||'';}));
    }
    var lr = sheet.getLastRow(), lc = sheet.getLastColumn();
    if (lr>0 && lc>0) sheet.getRange(1,1,lr,Math.max(lc,HEADERS.length)).clearContent();
    var tr = sheet.getMaxRows();
    if (tr > allRows.length+1) sheet.deleteRows(allRows.length+1, tr-allRows.length);
    sheet.getRange(1,1,allRows.length,HEADERS.length).setValues(allRows);
    sheet.getRange(1,1,1,HEADERS.length).setFontWeight('bold');
    return resp({ success: true, updated: tasks.length });
  } catch(err) { return resp({ error: err.message }); }
}

function setupDashboard() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dataSheet = getDataSheet();
  var dash = ss.getSheetByName(DASH_SHEET);
  if (dash) {
    dash.clear(); dash.clearConditionalFormatRules();
    var b = dash.getBandings(); for(var i=0;i<b.length;i++) b[i].remove();
  } else { dash = ss.insertSheet(DASH_SHEET, 0); }

  // Copy data directly (no QUERY formula — works in all locales)
  var src = dataSheet.getDataRange().getValues();
  var rows = [['Title','Description','Priority','Status','Details']];
  for (var i=1; i<src.length; i++) {
    if (!String(src[i][1]).trim()) continue;
    rows.push([src[i][1], src[i][2], src[i][3], src[i][4], src[i][5]]);
  }
  var n = rows.length;
  dash.getRange(1,1,n,5).setValues(rows);

  // Header
  dash.getRange('A1:E1').setFontWeight('bold').setFontColor('#ffffff')
    .setBackground('#1e293b').setFontSize(10).setHorizontalAlignment('center');
  dash.setFrozenRows(1);

  // Column widths
  dash.setColumnWidth(1,280); dash.setColumnWidth(2,360);
  dash.setColumnWidth(3,100); dash.setColumnWidth(4,120); dash.setColumnWidth(5,360);

  if (n > 1) {
    // Data area
    dash.getRange(2,1,n-1,5).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP)
      .setVerticalAlignment('top').setFontSize(10);

    // Conditional formatting
    var pCol = dash.getRange('C2:C'+n), sCol = dash.getRange('D2:D'+n);
    var rules = [];
    var pColors = [
      ['urgent','#fecaca','#991b1b',true], ['high','#fed7aa','#9a3412',true],
      ['medium','#dbeafe','#1e40af',false], ['low','#f3f4f6','#6b7280',false]
    ];
    for (var i=0;i<pColors.length;i++) {
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo(pColors[i][0]).setBackground(pColors[i][1])
        .setFontColor(pColors[i][2]).setBold(pColors[i][3])
        .setRanges([pCol]).build());
    }
    var sColors = [
      ['todo','#dbeafe','#1e40af'], ['backlog','#e0e7ff','#4338ca'],
      ['in_progress','#fef3c7','#92400e'], ['done','#d1fae5','#065f46']
    ];
    for (var i=0;i<sColors.length;i++) {
      rules.push(SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo(sColors[i][0]).setBackground(sColors[i][1])
        .setFontColor(sColors[i][2]).setRanges([sCol]).build());
    }
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=AND(ISEVEN(ROW()),$A2<>"")')
      .setBackground('#f8fafc').setRanges([dash.getRange('A2:E'+n)]).build());
    dash.setConditionalFormatRules(rules);
  }

  // Clean up extra cols/rows
  if (dash.getMaxColumns()>5) dash.deleteColumns(6, dash.getMaxColumns()-5);
  var maxR = dash.getMaxRows();
  if (maxR > n) dash.deleteRows(n+1, maxR-n);
  ss.setActiveSheet(dash);
  return resp({ ok:true, message:'Dashboard refreshed ('+(n-1)+' tasks)' });
}

function onEdit(e) {
  var sheet = e.source.getActiveSheet();
  if (sheet.getName() !== DATA_SHEET) return;
  var row = e.range.getRow();
  if (row < 2) return;
  var headers = sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0];
  var col = headers.indexOf('updatedAt');
  if (col===-1 || e.range.getColumn()===col+1) return;
  sheet.getRange(row, col+1).setValue(new Date().toISOString());
}

function resp(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}`

interface SheetSyncPanelProps {
  projectId: string
  tasks: Task[]
}

export function SheetSyncPanel({ projectId, tasks }: SheetSyncPanelProps) {
  const { config, save, clear } = useSyncConfig(projectId)
  const push = useSyncPush(projectId)
  const pull = useSyncPull(projectId)
  const test = useSyncTest()
  const setup = useSyncSetup()

  const [popoverOpen, setPopoverOpen] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [autoSync, setAutoSync] = useState(false)
  const [syncPrompt, setSyncPrompt] = useState(true)
  const [showScript, setShowScript] = useState(false)
  const [copied, setCopied] = useState(false)

  const isWorking = push.isPending || pull.isPending || setup.isPending

  const handleOpenPopover = useCallback(() => {
    setUrlInput(config?.url || '')
    setAutoSync(config?.autoSync || false)
    setSyncPrompt(config?.syncPrompt !== false)
    setShowScript(false)
    setCopied(false)
  }, [config])

  const handleSave = useCallback(() => {
    const url = urlInput.trim()
    if (!url) {
      toast.error('Enter an Apps Script URL')
      return
    }
    if (!url.startsWith('https://script.google.com/macros/s/')) {
      toast.error('URL must start with https://script.google.com/macros/s/')
      return
    }
    save({
      url,
      autoSync,
      syncPrompt,
      lastSyncAt: config?.lastSyncAt || null,
      lastSyncStatus: config?.lastSyncStatus || null,
      lastSyncError: config?.lastSyncError || null,
    })
    setPopoverOpen(false)
    toast.success('Google Sheet sync configured')
  }, [urlInput, autoSync, syncPrompt, config, save])

  const handleTest = useCallback(() => {
    const url = urlInput.trim()
    if (!url) return
    test.mutate(url, {
      onSuccess: (data) => {
        toast.success(`Connected! Sheet has ${data.data?.rows ?? '?'} task rows.`)
      },
      onError: (err) => {
        toast.error(`Connection failed: ${err.message}`)
      },
    })
  }, [urlInput, test])

  const handleDisconnect = useCallback(() => {
    clear()
    setPopoverOpen(false)
    toast.info('Google Sheet disconnected')
  }, [clear])

  const handlePush = useCallback(() => {
    if (!config?.url) return
    push.mutate({ url: config.url, tasks })
  }, [config, push, tasks])

  const handlePull = useCallback(() => {
    if (!config?.url) return
    pull.mutate({ url: config.url })
  }, [config, pull])

  const handleSetup = useCallback(() => {
    if (!config?.url) return
    setup.mutate(config.url, {
      onSuccess: () => toast.success('Dashboard sheet created with formatting!'),
      onError: (err) => toast.error(`Setup failed: ${err.message}`),
    })
  }, [config, setup])

  const handleCopyScript = useCallback(() => {
    navigator.clipboard.writeText(APPS_SCRIPT_TEMPLATE)
    setCopied(true)
    toast.success('Apps Script copied to clipboard')
    setTimeout(() => setCopied(false), 2000)
  }, [])

  const lastSyncLabel = config?.lastSyncAt
    ? formatDistanceToNow(new Date(config.lastSyncAt), { addSuffix: true })
    : null

  // Not configured — show setup button
  if (!config) {
    return (
      <Popover open={popoverOpen} onOpenChange={(open) => { setPopoverOpen(open); if (open) handleOpenPopover() }}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5">
                <Sheet className="h-3.5 w-3.5" />
                Sheets
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Sync tasks with a Google Sheet</TooltipContent>
        </Tooltip>
        <PopoverContent className="w-96" align="end">
          <SetupContent
            urlInput={urlInput}
            setUrlInput={setUrlInput}
            autoSync={autoSync}
            setAutoSync={setAutoSync}
            syncPrompt={syncPrompt}
            setSyncPrompt={setSyncPrompt}
            showScript={showScript}
            setShowScript={setShowScript}
            copied={copied}
            onCopyScript={handleCopyScript}
            onTest={handleTest}
            onSave={handleSave}
            isTesting={test.isPending}
          />
        </PopoverContent>
      </Popover>
    )
  }

  // Configured — show sync controls
  return (
    <div className="flex items-center gap-1">
      {/* Status badge */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1 text-[10px] text-emerald-500 font-medium px-1.5 py-0.5 rounded bg-emerald-500/10 cursor-default">
            <Sheet className="h-3 w-3" />
            Sheets
            {config.lastSyncStatus === 'error' && <XCircle className="h-3 w-3 text-red-400" />}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          {config.lastSyncStatus === 'error'
            ? `Sync error: ${config.lastSyncError}`
            : lastSyncLabel
              ? `Last synced ${lastSyncLabel}`
              : 'Connected to Google Sheet'
          }
          {config.autoSync && ' (auto-sync on)'}
        </TooltipContent>
      </Tooltip>

      {/* Pull */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handlePull} disabled={isWorking}>
            {pull.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Pull tasks from Google Sheet (overwrites local)</TooltipContent>
      </Tooltip>

      {/* Push */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handlePush} disabled={isWorking}>
            {push.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Push local tasks to Google Sheet (overwrites sheet)</TooltipContent>
      </Tooltip>

      {/* Format Dashboard */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleSetup} disabled={isWorking}>
            {setup.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paintbrush className="h-3.5 w-3.5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Create/refresh formatted Dashboard sheet (safe to re-run)</TooltipContent>
      </Tooltip>

      {/* Settings */}
      <Popover open={popoverOpen} onOpenChange={(open) => { setPopoverOpen(open); if (open) handleOpenPopover() }}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                <Settings2 className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Sheet sync settings</TooltipContent>
        </Tooltip>
        <PopoverContent className="w-96" align="end">
          <SetupContent
            urlInput={urlInput}
            setUrlInput={setUrlInput}
            autoSync={autoSync}
            setAutoSync={setAutoSync}
            syncPrompt={syncPrompt}
            setSyncPrompt={setSyncPrompt}
            showScript={showScript}
            setShowScript={setShowScript}
            copied={copied}
            onCopyScript={handleCopyScript}
            onTest={handleTest}
            onSave={handleSave}
            onDisconnect={handleDisconnect}
            isTesting={test.isPending}
            isConfigured
            lastSyncLabel={lastSyncLabel}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}

// --- Setup/Config popover content ---

interface SetupContentProps {
  urlInput: string
  setUrlInput: (v: string) => void
  autoSync: boolean
  setAutoSync: (v: boolean) => void
  syncPrompt: boolean
  setSyncPrompt: (v: boolean) => void
  showScript: boolean
  setShowScript: (v: boolean) => void
  copied: boolean
  onCopyScript: () => void
  onTest: () => void
  onSave: () => void
  onDisconnect?: () => void
  isTesting: boolean
  isConfigured?: boolean
  lastSyncLabel?: string | null
}

function SetupContent({
  urlInput, setUrlInput, autoSync, setAutoSync,
  syncPrompt, setSyncPrompt,
  showScript, setShowScript, copied, onCopyScript,
  onTest, onSave, onDisconnect, isTesting,
  isConfigured, lastSyncLabel,
}: SetupContentProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold">Google Sheet Sync</h4>
        <p className="text-[11px] text-muted-foreground">
          Two-sheet system: <strong>Data</strong> (raw sync) + <strong>Dashboard</strong> (formatted view).
          Sync only touches Data — your formatting in Dashboard is permanent.
        </p>
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-2">
        <a
          href="https://sheets.new"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-500 hover:text-blue-400 underline underline-offset-2 transition-colors"
        >
          1. Create a Sheet
        </a>
        <span className="text-muted-foreground/30">|</span>
        <button
          onClick={onCopyScript}
          className="text-xs text-blue-500 hover:text-blue-400 underline underline-offset-2 transition-colors flex items-center gap-1"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          2. Copy Script
        </button>
        <span className="text-muted-foreground/30">|</span>
        <button
          onClick={() => setShowScript(!showScript)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showScript ? 'Hide guide' : 'Full guide'}
        </button>
      </div>

      {showScript && (
        <div className="space-y-2 rounded-md border p-3 bg-muted/50">
          <ol className="text-[11px] text-muted-foreground space-y-1 list-decimal list-inside">
            <li>Click <strong>"Create a Sheet"</strong> above to open a new spreadsheet</li>
            <li>Click <strong>"Copy Script"</strong> above to copy the Apps Script code</li>
            <li>In the sheet: <strong>Extensions &gt; Apps Script</strong></li>
            <li>Delete default code, paste the copied script, save</li>
            <li><strong>Deploy &gt; New deployment &gt; Web App</strong></li>
            <li>Execute as <strong>Me</strong>, Access <strong>Anyone</strong>, click Deploy</li>
            <li>Copy the deployment URL and paste below</li>
          </ol>
          <p className="text-[10px] text-muted-foreground/70">
            After deploying, do a Push, then click the <strong>paintbrush</strong> button to create the formatted Dashboard.
            Click paintbrush again after each Push to refresh the Dashboard view.
          </p>
          <div className="relative">
            <pre className="text-[10px] bg-background rounded p-2 overflow-auto max-h-36 border font-mono">
              {APPS_SCRIPT_TEMPLATE}
            </pre>
          </div>
        </div>
      )}

      {/* URL input */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium">Apps Script URL</label>
        <input
          type="url"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="https://script.google.com/macros/s/..."
          className="w-full rounded-md border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Auto-sync toggle */}
      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input
          type="checkbox"
          checked={autoSync}
          onChange={(e) => setAutoSync(e.target.checked)}
          className="rounded border-muted-foreground/30"
        />
        Auto-pull on workspace open
      </label>

      {/* Sync prompt toggle */}
      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input
          type="checkbox"
          checked={syncPrompt}
          onChange={(e) => setSyncPrompt(e.target.checked)}
          className="rounded border-muted-foreground/30"
        />
        Include details/prompt column
      </label>

      {/* Last sync info */}
      {isConfigured && lastSyncLabel && (
        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
          Last synced {lastSyncLabel}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button size="sm" className="h-7 text-xs flex-1" onClick={onSave}>
          Save
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onTest} disabled={isTesting || !urlInput.trim()}>
          {isTesting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
          Test
        </Button>
        {isConfigured && onDisconnect && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-400 hover:text-red-300" onClick={onDisconnect}>
                <Unplug className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Disconnect Google Sheet</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
