'use strict';
const {test,expect,gotoApp}=require('./app-test');

for(const width of [320,360,390,430]){
  test(`shared compact grid keeps note action in row 2 column 2 at ${width}px`,async({page,appEnv})=>{
    await page.setViewportSize({width,height:820});
    const errors=await gotoApp(page,appEnv.url);
    await page.evaluate(()=>{
      const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
      const base={date:currentTicketDate,time:'09:00',city:'Дніпро',address:'вул. Робоча 15',sum:450,photos:[image]};
      // Memory-only fixture in isolated E2E profile: no save, enqueue or send.
      tickets=[
        {id:'align-connection',type:'Підключення',content:'Робота'},
        {id:'align-repair',type:'Ремонт',content:'Робота'},
        {id:'align-short',type:'Інше',otherNote:'Коротка нотатка'},
        {id:'align-medium',type:'Інше',otherNote:'Середня нотатка з кількома словами для переносу'},
        {id:'align-long',type:'Інше',otherNote:('ДовгаНотаткаБезПробілів'.repeat(25)+' повний текст. ').repeat(3)}
      ].map(t=>Object.assign(blankTicketObject(),base,t));
      globalThis.MTDispatcherReport={delivery:()=>({state:'sent',code:''}),badge:()=> 'Таблиця Д ✅'};
      MTTicketCompactView.setMode('compact');renderTicketsScreen();
    });
    const geometry=()=>page.locator('.ticket-compact-card').evaluateAll(cards=>cards.map(card=>{
      const box=card.getBoundingClientRect(),button=card.querySelector('.ticket-view-expand-btn'),note=card.querySelector('.ticket-compact-address');
      const b=button.getBoundingClientRect(),n=note.getBoundingClientRect(),s=getComputedStyle(button),ns=getComputedStyle(note);
      return {id:card.dataset.id,parent:button.parentElement.className,grid:[s.gridRowStart,s.gridColumnStart],noteGrid:[ns.gridRowStart,ns.gridColumnStart],position:s.position,
        width:b.width,height:b.height,right:box.right-b.right,bottom:box.bottom-b.bottom,y:b.y-box.y,cardHeight:box.height,
        margin:s.margin,padding:s.padding,align:s.justifySelf,overlap:n.right>b.left+0.5&&n.bottom>b.top&&n.top<b.bottom,
        overflow:card.scrollWidth>card.clientWidth||box.right>innerWidth+0.5||box.left<0};
    }));
    const current=await geometry();expect(current).toHaveLength(5);
    for(const item of current){
      expect(item.parent).toBe('ticket-compact-card');expect(item.grid).toEqual(['2','2']);expect(item.noteGrid).toEqual(['2','1']);
      expect(item.position).not.toBe('absolute');expect(item.overlap).toBe(false);expect(item.overflow).toBe(false);
      expect(item.height).toBeGreaterThanOrEqual(40);
      for(const field of ['width','height','right','bottom','margin','padding','align'])expect(item[field],item.id+' '+field).toEqual(current[0][field]);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    // Restore the exact previous auto-placement mechanism only in the fixture.
    // Ordinary four-child cards must keep identical geometry with explicit slots.
    const oldPlacement=await page.addStyleTag({content:'.ticket-compact-card > .ticket-compact-meta,.ticket-compact-card > .ticket-compact-sum,.ticket-compact-card > .ticket-compact-address,.ticket-compact-card > .ticket-view-expand-btn{grid-column:auto;grid-row:auto;}'});
    const previous=await geometry();
    for(let i=0;i<2;i++)for(const field of ['width','height','right','bottom','y','cardHeight','margin','padding','align'])expect(current[i][field],'normal '+field).toEqual(previous[i][field]);
    expect(previous[2].grid).toEqual(['auto','auto']);
    await oldPlacement.evaluate(el=>el.remove());
    for(const id of ['align-short','align-medium','align-long']){
      const card=page.locator('.ticket-compact-card[data-id="'+id+'"]');
      await expect(card.locator('.ticket-compact-sum')).toHaveCount(0);await expect(card.locator('.ticket-compact-address')).not.toBeEmpty();
      await expect(card.locator('.ticket-view-expand-btn')).toHaveCount(1);await card.locator('.ticket-view-expand-btn').click();
      const expanded=page.locator('.ticket-compact-expanded[data-id="'+id+'"]');
      await expect(expanded.locator('.tc-details')).toBeVisible();await expect(expanded.locator('.tc-status-row')).toContainText('Таблиця Д ✅');
      await expect(expanded.locator('.tc-photo-toggle-btn')).toBeVisible();await expect(expanded.locator('.tc-expand-btn')).toHaveCount(0);
      await expect(expanded.locator('.ticket-view-collapse-btn')).toHaveCount(1);await expanded.locator('.ticket-view-collapse-btn').click();
      await expect(card).toBeVisible();await expect(expanded).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}
