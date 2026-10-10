from playwright.sync_api import sync_playwright
from pathlib import Path
ROOT=Path(__file__).resolve().parent
out=ROOT/'capturas';out.mkdir(exist_ok=True)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--allow-file-access-from-files'])
    page=b.new_page(viewport={'width':1650,'height':1000},device_scale_factor=1)
    page.set_content((ROOT/'SAI_GC_MVP_ABRIR.html').read_text(),wait_until='load')
    print('title',page.title(),'buttons',page.locator('button').count())
    page.click('#process-btn');page.wait_for_timeout(400)
    assert page.locator('#class-chip').inner_text()=='A'
    page.screenshot(path=str(out/'01_atencion_triaje_A.png'),full_page=True)
    page.locator('#case-select').select_option('DEMO-002');page.click('#process-btn')
    assert page.locator('#class-chip').inner_text()=='B'
    page.screenshot(path=str(out/'02_atencion_triaje_B.png'),full_page=True)
    page.locator('#case-select').select_option('DEMO-003');page.click('#process-btn')
    assert page.locator('#class-chip').inner_text()=='C'
    page.locator('[data-action="Escalar"]').click()
    assert 'Escalar' in page.locator('#action-result').inner_text()
    page.screenshot(path=str(out/'03_atencion_triaje_C.png'),full_page=True)
    page.click('#assign-btn')
    assert 'confirmada' in page.locator('#route-reason').inner_text()
    page.locator('[data-tab="supervision"]').click(); page.screenshot(path=str(out/'04_supervision_agentes.png'),full_page=True)
    page.locator('[data-tab="colas"]').click(); page.screenshot(path=str(out/'05_retraso_colas.png'),full_page=True)
    page.locator('[data-tab="curso"]').click(); page.screenshot(path=str(out/'06_trabajo_en_curso.png'),full_page=True)
    page.locator('[data-tab="bitacora"]').click(); page.screenshot(path=str(out/'07_bitacora.png'),full_page=True)
    page.locator('[data-tab="config"]').click();page.screenshot(path=str(out/'08_configuracion.png'),full_page=True)
    page.locator('input[value="experimental"]').check()
    page.locator('[data-tab="atencion"]').click();page.click('#process-btn')
    assert '7 unidades' in page.locator('#weight').inner_text()
    print('Browser interactions verified; screenshots',len(list(out.glob('*.png'))))
    b.close()
