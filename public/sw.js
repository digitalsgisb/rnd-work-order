
self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// No offline caching of company data.
// Push notification handlers will be added
// in the next development phase.


// Receive background push notifications

self.addEventListener('push',event=>{

  event.waitUntil((async()=>{

    let data={};

    try {
      data=event.data?.json()||{};
    } catch {}

    const messages = {
      submitted: [
        'Approval required',
        'A work order requires your approval.'
      ],
      approved: [
        'Work order approved',
        'An approved work order has a new update.'
      ],
      assigned: [
        'New work assignment',
        'A work order has been assigned to you.'
      ],
      verification: [
        'Verification required',
        'A completed work order requires verification.'
      ],
      completed: [
        'Work completed',
        'A work order requires your acknowledgement.'
      ],
      verified: [
        'Work verified',
        'A work order is ready for acknowledgement.'
      ],
      rework: [
        'Rework requested',
        'Additional work is required.'
      ],
      reopened: [
        'Work order reopened',
        'A closed work order has been reopened.'
      ],
      returned: [
        'Correction required',
        'A request has been returned for correction.'
      ],
      rejected: [
        'Request rejected',
        'Open the app for further details.'
      ],
      closed: [
        'Work order closed',
        'A work order has been acknowledged and closed.'
      ],
      unable: [
        'Unable to proceed',
        'Open the app for further details.'
      ],
      due_soon: [
        'Due date approaching',
        'A work order is due soon.'
      ],
      overdue: [
        'Work order overdue',
        'A work order requires your attention.'
      ]
    };

    const [title,body] =
      Object.hasOwn(messages,data.eventType)
        ? messages[data.eventType]
        : [
            'R&D Work Order',
            'You have a new work order update.'
          ];

    await self.registration.showNotification(
      title,
      {
        body,
        icon:'/icons/icon-192.png',
        badge:'/icons/icon-192.png',
        data:{
          notificationId:data.notificationId||null
        }
      }
    );

  })());

});

// Open the app when notification is tapped

self.addEventListener('notificationclick',event=>{

  event.notification.close();

  event.waitUntil((async()=>{

    const target=new URL(
      '/?notifications=1',
      self.location.origin
    ).href;

    const windows=await self.clients.matchAll({
      type:'window',
      includeUncontrolled:true
    });

    for(const client of windows) {
      if(new URL(client.url).origin===self.location.origin) {
        await client.navigate(target);
        return client.focus();
      }
    }

    return self.clients.openWindow(target);

  })());

});
