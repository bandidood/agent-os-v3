# ScadaBR 1.2 DWR2 & Selenium Automation Reference

ScadaBR has no REST API. Configuration can be automated via two approaches:
1. **DWR (Direct Web Remoting)** — for datasource creation, toggle, force reads
2. **Selenium + headless Chromium** — for data point type configuration, HMI view creation, and any operation involving HTML `<select>` elements

## ⚠️ DWR2 Object_Object Bug (CRITICAL)

The DWR2 `Object_Object:{}` format for `saveModbusPointLocator`'s `locator` parameter **ignores enum properties** (`range`, `modbusDataType`). They always default to `1` (Binary/Coil) regardless of values passed. This means:
- `holding_register` points CANNOT be created correctly via pure DWR
- `2byte_unsigned_int` data type CANNOT be set via DWR
- All points created via `saveModbusPointLocator` will have `range=1` (Coil status) and `modbusDataType=1` (Binary)

**Workaround**: Use Selenium to navigate to the ScadaBR edit page, click `editPoint()`, change `<select id="range">` and `<select id="modbusDataType">` via `Select(element).select_by_value()`, then `savePoint()`. This triggers the correct DWR callbacks internally.

## Prerequisites
- ScadaBR running on Tomcat 9 (port 8080)
- Admin credentials (default: admin/admin)
- Python3 + `requests` library on the VM (for DWR)
- Python3 + `selenium` + Chromium (for point type config & view creation)
- Install: `apt install chromium` and `pip3 install selenium`

## DWR Session Initialization Flow (MANDATORY)

Every DWR automation session MUST follow these steps in order. Skipping any step causes `NullPointerException`.

```python
import requests

s = requests.Session()

# 1. Login
s.post("http://localhost:8080/ScadaBR/login.htm",
       data={"username": "admin", "password": "admin"},
       allow_redirects=True)

# 2. Load the edit page (sets DS object in HTTP session)
#    For NEW datasource: use typeId param (3=Modbus IP)
s.get("http://localhost:8080/ScadaBR/data_source_edit.shtm?typeId=3")
#    For EXISTING datasource: use dsid param
# s.get("http://localhost:8080/ScadaBR/data_source_edit.shtm?dsid=1")

# 3. Call editInit to populate session state
dwr_headers = {"Content-Type": "text/plain"}
s.post("http://localhost:8080/ScadaBR/dwr/call/plaincall/DataSourceEditDwr/editInit.dwr",
       data="callCount=1\npage=/ScadaBR/data_source_edit.shtm\nhttpSessionId=\nscriptSessionId=\nc0-scriptName=DataSourceEditDwr\nc0-methodName=editInit\nc0-id=0\nbatchId=1",
       headers=dwr_headers)
```

## DWR2 Wire Format

All DWR calls use POST to `/ScadaBR/dwr/call/plaincall/<Interface>.<method>.dwr` with `Content-Type: text/plain`.

### Scalar Parameters
```
c0-param0=string:value
c0-param1=number:42
c0-param2=boolean:true
```

### Object Parameters (DWR2 Bean Format)
```
c0-param3=Object_Object:{prop1=reference:type:value,prop2=reference:type:value2}
```

Types: `number`, `string`, `boolean`. Empty strings: `reference:string:`.

**WRONG formats** (cause MarshallException "Missing: {"):
- `class:Object{...}`
- `javascript:{...}`
- Raw JSON `{...}`

### Full Call Template
```
callCount=1
page=/ScadaBR/data_source_edit.shtm
httpSessionId=
scriptSessionId=
c0-scriptName=<Interface>
c0-methodName=<method>
c0-id=0
c0-param0=<type>:<value>
c0-param1=Object_Object:{...}
batchId=1
```

## Key DWR Interfaces

### DataSourceListDwr
- `initialize()` — returns DS list (empty on fresh install)
- `toggleDataSource(p0: number)` — enable/disable DS by ID
- `toggleDataPoint(p0: number)` — enable/disable point by ID

### DataSourceEditDwr
- `editInit()` — MUST call before any edit operation
- `saveModbusIpDataSource(p0-p16, callback)` — create/update Modbus IP datasource
- `saveModbusPointLocator(p0-p3, callback)` — create/update Modbus data point (**BUG: range/modbusDataType ignored**)
- `enableAllPoints()` — enable all points on current DS (needs editInit first)
- `getPoints()` — list points on current DS
- `toggleEditDataSource()` — toggle DS enabled state
- `deletePoint(p0: number)` — delete point by ID

### ViewDwr (HMI Views)
- `getViews()` — list all views
- `addComponent(type)` — add component to current view. Types: `simple`, `html`, `binaryGraphic`, `analogGraphic`, `dynamicGraphic`, `multistateGraphic`, `link`, `scriptButton`, `script`, `imageChart`, `compound`
- `setViewComponentLocation(id, x, y)` — position a component
- `setPointComponentSettings(id, pointId, name, settable, bkgdColor, controls)` — associate a point with a component
- `saveSimplePointComponent(compId, settableOverride, displaySuffix)` — save simple point renderer
- `saveHtmlComponent(compId, htmlContent)` — save HTML component
- `saveBinaryGraphicComponent(compId, zeroImage, oneImage, width, height)` — save binary graphic (image set name + individual image filenames)
- `saveAnalogGraphicComponent(compId, min, max, renderImage, width, height)` — save analog graphic
- `deleteViewComponent(compId)` — delete a component

### MiscDwr
- `forcePointRead(p0: number)` — trigger immediate read of a point
- `setPoint(p0, p1, p2)` — set point value

## saveModbusIpDataSource — 17 Parameters

Found in `/opt/tomcat9/webapps/ScadaBR/WEB-INF/jsp/dataSourceEdit/editModbusIp.jsp`:

| # | Name | Type | Example |
|---|------|------|---------|
| 0 | dataSourceName | string | OpenPLC_Modbus |
| 1 | dataSourceXid | string | DS_ModbusIP_001 |
| 2 | updatePeriods | string | 2 |
| 3 | updatePeriodType | string | 1 |
| 4 | quantize | boolean | false |
| 5 | timeout | string | 3000 |
| 6 | retries | string | 3 |
| 7 | contiguousBatches | boolean | true |
| 8 | createSlaveMonitorPoints | boolean | false |
| 9 | maxReadBitCount | string | 2048 |
| 10 | maxReadRegisterCount | string | 125 |
| 11 | maxWriteRegisterCount | string | 63 |
| 12 | transportType | string | TCP |
| 13 | host | string | 127.0.0.1 |
| 14 | port | string | 502 |
| 15 | encapsulated | boolean | false |
| 16 | createSocketMonitorPoint | boolean | false |

### Transport Types
- `TCP` — standard Modbus TCP client
- `TCP_KEEP_ALIVE` — persistent TCP connection
- `UDP` — Modbus UDP
- `TCP_LISTENER` — listens for incoming connections

### updatePeriodType Values
- `1` = seconds, `2` = minutes, `3` = hours, `4` = milliseconds

## Selenium + Headless Chromium Approach

For operations that DWR cannot handle (data point type config, HMI view creation), use Selenium.

### Setup on VM 305
```bash
apt install -y chromium
pip3 install selenium
```

### Fixing Data Point Types (range, modbusDataType)

After creating points via DWR (which always creates them as Binary/Coil), use Selenium to change the type:

```python
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import Select
import time

opts = Options()
opts.add_argument("--headless=new")
opts.add_argument("--no-sandbox")
opts.add_argument("--disable-dev-shm-usage")
driver = webdriver.Chrome(options=opts)

# Login
driver.get("http://localhost:8080/ScadaBR/login.htm")
driver.find_element(By.NAME, "username").send_keys("admin")
driver.find_element(By.NAME, "password").send_keys("admin")
driver.find_element(By.CSS_SELECTOR, "input[type='submit']").click()
time.sleep(2)

# Navigate to datasource edit for existing DS
driver.get("http://localhost:8080/ScadaBR/data_source_edit.shtm?dsid=1")
time.sleep(3)
driver.execute_script("DataSourceEditDwr.editInit(function(){});")
time.sleep(2)

# For each point to fix:
# 1. Click editPoint(id) to open the editor
# 2. Select the correct range and modbusDataType
# 3. Click savePoint()

# Example: fix point 5 to Holding Register + 2 byte unsigned int
driver.execute_script("editPoint(5)")
time.sleep(2)

# Select "Holding register" (value=3) in the range dropdown
Select(driver.find_element(By.ID, "range")).select_by_value("3")
time.sleep(1)

# Select "2 byte unsigned integer" (value=2) in modbusDataType dropdown
Select(driver.find_element(By.ID, "modbusDataType")).select_by_value("2")
time.sleep(1)

# Set offset
driver.execute_script("document.getElementById('offset').value = '0'")

# Save
driver.execute_script("savePoint()")
time.sleep(2)

driver.quit()
```

### Available ScadaBR Graphic Image Sets

Located in `/opt/tomcat9/webapps/ScadaBR/graphics/`:
- `BlinkingLights` — light_green_off.gif, light_green.gif, light_red_off.gif, light_red.gif
- `Bullets` — black.png, blue.png, green.png, etc.
- `GreenThermo` — thermometer0.jpg through thermometer9.jpg
- Various 3D elements: Bomba-3D, Botao-3D, etc.

### Range Values (for `<select id="range">`)
- 1 = Coil status (coils)
- 2 = Input status (discrete inputs)
- 3 = Holding register (read/write registers)
- 4 = Input register (read-only registers)

### ModbusDataType Values (for `<select id="modbusDataType">`)
- 1 = Binary (for coils/inputs)
- 2 = 2 byte unsigned integer
- 3 = 2 byte signed integer
- 4 = 4 byte unsigned integer (low word first)
- 5 = 4 byte signed integer (low word first)
- 6 = 4 byte float (low word first)
- 7 = 4 byte float (high word first)
- 8 = 8 byte double (low word first)
- 9 = 8 byte double (high word first)
- 10+ = various string and other types

## Creating HMI Views via Selenium

Views (mangoViews table) are created via form POST, then components are added via ViewDwr DWR calls in Selenium.

### View Creation Process

```python
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
import time, json

opts = Options()
opts.add_argument("--headless=new")
opts.add_argument("--no-sandbox")
opts.add_argument("--disable-dev-shm-usage")
opts.add_argument("--window-size=1920,1080")
driver = webdriver.Chrome(options=opts)

# Step 1: Login
driver.get("http://localhost:8080/ScadaBR/login.htm")
time.sleep(1)
driver.find_element(By.NAME, "username").send_keys("admin")
driver.find_element(By.NAME, "password").send_keys("admin")
driver.find_element(By.CSS_SELECTOR, "input[type='submit']").click()
time.sleep(2)

# Step 2: Create view via form POST (CRITICAL - DWR alone doesn't persist)
import requests
s = requests.Session()
s.post("http://localhost:8080/ScadaBR/login.htm",
       data={"username": "admin", "password": "admin"}, allow_redirects=True)
s.post("http://localhost:8080/ScadaBR/view_edit.shtm",
       data={"view.name": "MyView", "view.xid": "GV_MyView001",
             "view.anonymousAccess": "1", "view.background": "#1a1a2e", "save": "Save"})
# This redirects to view_edit.shtm?viewId=X

# Step 3: Add components via Selenium + ViewDwr
driver.get("http://localhost:8080/ScadaBR/view_edit.shtm?viewId=1")
time.sleep(3)

# Add a simple point component
comp = json.loads(driver.execute_script(
    "return new Promise((resolve) => { "
    "ViewDwr.addComponent('simple', function(result) { "
    "resolve(JSON.stringify({id: result.id})); }); });"
))
comp_id = comp["id"]

# Position it
driver.execute_script(f"ViewDwr.setViewComponentLocation({comp_id}, 20, 100, function(){{}});")

# Associate a data point
driver.execute_script(f"ViewDwr.setPointComponentSettings({comp_id}, 5, 'Register_QW0', null, null, null, function(r){{}});")

# Save as simple point: (String compId, boolean settableOverride, String displaySuffix)
driver.execute_script(f"ViewDwr.saveSimplePointComponent('{comp_id}', false, '', function(r){{}});")
time.sleep(1)

# Add HTML component
comp = json.loads(driver.execute_script(
    "return new Promise((resolve) => { "
    "ViewDwr.addComponent('html', function(result) { "
    "resolve(JSON.stringify({id: result.id})); }); });"
))
html_id = comp["id"]
driver.execute_script(f"ViewDwr.setViewComponentLocation({html_id}, 10, 10, function(){{}});")
driver.execute_script("ViewDwr.saveHtmlComponent(" + str(html_id) + ", '<h1>Dashboard</h1>', function(r){});")
time.sleep(1)

# Step 4: SAVE the view (CRITICAL)
# settingsEditor.save() only saves component settings, NOT the view itself
# The view is persisted only when the page form is submitted
# Either:
# (a) Submit the form via Selenium
driver.execute_script("""
    var form = document.querySelector('form[action*="view_edit"]');
    if (form) { form.submit(); }
""")
time.sleep(3)
# OR: Use requests Session from Step 2 to POST

driver.quit()
```

### Key ViewDwr Method Signatures (from javap)
```
addComponent(String type) → ViewComponent
saveSimplePointComponent(String compId, boolean settableOverride, String displaySuffix)
saveHtmlComponent(String compId, String htmlContent)
saveBinaryGraphicComponent(String compId, int zeroImageIndex, int oneImageIndex, boolean displayText, String imageSetName)
saveAnalogGraphicComponent(String compId, double min, double max, boolean displayText, String imageSetName)
setPointComponentSettings(int compId, int pointId, String name, Object settable, Object bkgdColor, Object controls)
setViewComponentLocation(int compId, int x, int y)
deleteViewComponent(String compId)
```

### View Persistence Pitfall

**`settingsEditor.save()` does NOT persist the view to the database.** It only saves the component settings in-memory. The view is only persisted when the HTML form is submitted (either via Selenium `form.submit()` or via `requests.post` to `view_edit.shtm`). If you add components via DWR but don't submit the form, the view will have 0 bytes in the `mangoViews.data` column.

**Correct flow**: Create view via POST → Navigate to view_edit → Add components via ViewDwr → Submit form page → Verify in DB.

## Pitfalls

- **DWR2 ignores enum properties**: `range` and `modbusDataType` in `saveModbusPointLocator` always default to 1 (Binary/Coil). Use Selenium to configure non-binary point types.
- **Points created disabled**: `saveModbusPointLocator` creates points in disabled state. Must call `toggleDataPoint` for each to enable them.
- **Datasource created disabled**: `saveModbusIpDataSource` creates the datasource enabled if `updatePeriods` > 0, but points are always disabled. Enable via `toggleDataSource` + `toggleDataPoint`.
- **editInit required before EVERY edit session**: Even if the session cookie is valid, DWR calls fail with NullPointerException if `editInit` hasn't been called after navigating to the edit page.
- **page parameter must match**: The `page=` line in DWR calls should match the actual page URL (e.g., `data_source_edit.shtm` for edit operations, `data_sources.shtm` for list operations).
- **Response format**: DWR responses are JavaScript (`var s0={};s0.id=1;...dwr.engine._remoteHandleCallback(...)`), not JSON. Parse by checking for `Exception` in text or extracting key-value pairs with regex.
- **Selenium UnexpectedAlertPresentException**: DWR calls that fail show JavaScript `alert()` dialogs. Use `try/except UnexpectedAlertPresentException` with `driver.switch_to.alert.dismiss()` to handle them.
- **View creation requires form POST**: DWR `addComponent`, `saveSimplePointComponent`, `setViewComponentLocation` add components in-memory only. The view must be persisted via form submission (`view.name`, `view.xid`, `save=Save`).
- **`saveSimplePointComponent(String, boolean, String)`**: First arg is component ID (from `addComponent`), NOT point ID. Point association is via `setPointComponentSettings`.
- **ScadaBR graphics directory**: Image sets for graphical components are in `/opt/tomcat9/webapps/ScadaBR/graphics/`. Available sets: BlinkingLights, Bullets, GreenThermo, Bomba-3D, Botao-3D, Dial, Fan, etc.