import {
  CollectionHandoverStatus,
  OrderStatus,
  DeliveryFailureReason,
  DeliveryProofType,
  DeliveryPriority,
  DeliveryStatus,
  NotificationCategory,
  NotificationChannel,
  PaymentMethod,
  PaymentStatus,
  PurchaseOrderStatus,
  ReturnReason,
  ReturnStatus,
  ShopStatus,
  TripStatus,
  StocktakeStatus,
  StockMovementType,
  UserRole,
  UserStatus,
} from '@medsupply/shared-types';

/**
 * The English catalogue, and the shape every other language must match.
 *
 * A **TypeScript object literal, not JSON**, so `bn.ts` can be typed
 * `typeof en` — a missing or extra Bangla key becomes a compile error rather
 * than a screen that renders a key name at somebody in Dhaka.
 *
 * The status maps are `Record<Status, string>`, so adding a member to any
 * status enum in `@medsupply/shared-types` fails the build here until it has
 * been given words. That is what turns "the new status shows as raw
 * PARTIALLY_DELIVERED" from something a user reports into something the
 * compiler refuses.
 *
 * **Plain language is the rule, not a preference.** The people using this are
 * warehouse pickers, delivery riders, shop owners and accounts clerks. Nothing
 * here says FEFO, poisha, idempotency, immutable, ledger, basis points or
 * quarantine unless the reader is an accountant and the word is the right one.
 */
export const en = {
  common: {
    appName: 'MedSupply B2B',
    loading: 'Loading',
    searching: 'Searching…',
    retry: 'Try again',
    cancel: 'Cancel',
    save: 'Save',
    close: 'Close',
    search: 'Search',
    goHome: 'Go to the home screen',
    signIn: 'Sign in',
    signOut: 'Sign out',
    somethingWentWrong: 'Something went wrong',
    nothingHere: 'There is nothing here yet',
    reference: 'Reference',
    quoteReference: 'Quote this reference if you contact support',
    loadMore: 'Load more',
    loadingMore: 'Loading…',
    view: 'View',
    notSet: 'Not set',
    on: 'On',
    off: 'Off',
    active: 'Active',
    inactive: 'Not in use',
    nothing: 'None',
    between: '{{from}} to {{to}}',
  },

  auth: {
    signInTitle: 'Sign in to your account',
    email: 'Email address',
    password: 'Password',
    signingIn: 'Signing in…',
    invalidCredentials: 'That email address and password do not match an account.',
    changePassword: 'Change your password',
    currentPassword: 'Your current password',
    newPassword: 'New password',
    repeatPassword: 'New password again',
    passwordsDoNotMatch: 'These do not match.',
    passwordTooShort: 'Use at least {{minimum}} characters.',
    mustChangeTitle: 'Choose your own password',
    mustChangeBody:
      'Somebody set this password for you, so it is known to more than one person. Choose one only you know before you carry on.',
    signInFailed: 'You could not be signed in.',
    changeOwnTitle: 'Change your password',
    changeOwnBody: 'You will stay signed in here. Every other device will be signed out.',
    changed: 'Your password has been changed.',
    otherSignedOut: 'You were signed out of {{count}} other devices.',
    oneOtherSignedOut: 'You were signed out of one other device.',
    changeFailed: 'Your password could not be changed.',
    thatDidNotWork: 'That did not work',
    atLeast: 'At least {{minimum}} characters.',
    changeButton: 'Change my password',
    restoringSession: 'Restoring your session',
    sessionEnded: 'This session has ended. Sign in again.',
    /*
     * Not "you are not allowed". The account is fine and the download was
     * wrong, which are opposite problems with opposite next steps — so this
     * names the application to install instead.
     */
    wrongApp:
      'This is {{thisApp}}, and your account is not used here. Install {{theirApp}} and sign in there.',
    noAppForRole:
      'This account cannot be used in {{thisApp}}. Ask your manager which app to install.',
  },

  /**
   * The three applications, by the name a person reads under the icon.
   *
   * The same in both languages on purpose: this is what is printed in the store
   * listing and on the home screen, and telling somebody to install a name they
   * cannot then find is worse than not translating.
   */
  appVariant: {
    shop: 'MedSupply Shop',
    staff: 'MedSupply Manage',
    rider: 'MedSupply Rider',
  },

  /**
   * The home screen.
   *
   * The tile *titles* come from `@medsupply/navigation`, which mobile shares —
   * translating those belongs with that package, and doing it here would give
   * the two clients different words for the same screen. What is here is the
   * copy this page owns: the greeting, the section headings and the one-line
   * explanation of what each section is for.
   */
  dashboard: {
    welcome: 'Welcome back, {{name}}',
    subtitle: 'What is waiting for you, and everywhere else you can go in {{business}}.',
    groupWork: 'Work',
    groupCatalogue: 'Catalogue',
    groupPurchasing: 'Buying in',
    groupMoney: 'Money',
    groupInsight: 'Reports',
    groupAdministration: 'Administration',
    groupAccount: 'My account',
  },

  /**
   * The figures at the top of the home screen.
   *
   * Each is a backlog somebody can shorten today. The words go *under* the
   * number and explain it, so they read as the answer to "what is this" rather
   * than as a heading nobody needed.
   */
  home: {
    waitingForYou: 'Waiting for you',
    awaitingDecision: 'Orders waiting for your decision',
    toPick: 'Orders to pick',
    readyToHandOver: 'Packed, waiting for a rider',
    onTheRoad: 'Out for delivery now',
    youOwe: 'You owe',
    howTradeIsGoing: 'How trade is going',
    whoOwesUs: 'Who owes us, and for how long',
    bestSellers: 'Selling most',
    nothingOutstanding: 'Nothing is outstanding.',
    nothingSoldYet: 'Nothing has sold in this period yet.',
  },

  /** What each section is *for*, in the words of the person who uses it. */
  purpose: {
    orders: 'Track what has been ordered and where each order has reached.',
    approvals: 'Orders waiting for a decision on price, quantity and credit.',
    fulfilment: 'Pick lists waiting to be worked, and the ones in progress.',
    'fulfilment-ready': 'Packed orders waiting to be handed to a rider.',
    deliveries: 'Who is carrying what, and what has arrived.',
    returns: 'Goods coming back, and the credit notes raised against them.',
    medicines: 'The catalogue: what is sold, and at what price.',
    inventory: 'Batches on hand, what is reserved, and what is near expiry.',
    cart: 'The order you are putting together.',
    payments: 'Record, post, inspect and reverse customer payments.',
    collections: 'Cash riders have collected, waiting to be checked in.',
    'report-outstanding': 'What every shop owes today.',
    'report-overdue': 'What is past its due date, and by how long.',
    'report-collections': 'What has been collected, by whom, over a period.',
    analytics: 'Sales, stock and receivables at a glance.',
    'analytics-sales': 'What has been bought and returned over time.',
    'analytics-returns': 'What is coming back, and why.',
    'analytics-inventory': 'Stock cover, movement and expiry risk.',
    'analytics-deliveries': 'How deliveries are performing.',
    'analytics-receivables': 'How the debt is ageing.',
    shops: 'Customers, their credit terms and their licences.',
    users: 'People who can sign in, and what each of them may do.',
    settings: 'Tax, credit, expiry windows, notifications and branding.',
    audit: 'Every privileged action, who took it and when.',
    'shop-account': 'What you owe, what credit you have left, and your invoices.',
    'my-payments': 'Payments recorded against your account.',
    'my-statement': 'Your account, period by period.',
    notifications: 'Everything the system has told you.',
    activity: 'What has happened recently, across the business.',
    security: 'Where you are signed in, and how to sign out elsewhere.',
  } as Record<string, string>,

  /**
   * The explanation under every screen.
   *
   * Three questions, answered for somebody who has not been trained on this
   * product: what the screen is for, what to do on it, and how any figure on it
   * was arrived at. `PageGuide` renders them; `pageGuides.ts` maps a route to
   * the three keys.
   *
   * **Plain language is the rule, not a preference**, and it bites hardest
   * here. The reader is a pharmacy owner at seven in the morning, not the
   * person who specified the field. Write "what the shop pays", not "trade
   * price"; "the number goes up", not "the value is incremented". Say what
   * happens when they press the button.
   *
   * `…Maths` is only written where a screen shows a number somebody could
   * disagree with — a total, a balance, an ageing bucket, a margin. Screens
   * that compute nothing have no third answer rather than a sentence saying so,
   * because a paragraph explaining that there is no arithmetic is worse than
   * the silence it replaces.
   */
  guide: {
    heading: 'How this page works',
    whatLabel: 'What this page is for',
    useLabel: 'How to use it',
    mathsLabel: 'How the figures are worked out',

    dashboardWhat:
      'Your home screen. The boxes at the top are work waiting for you today; everything below is a way into every other part of the system.',
    dashboardUse:
      'Click a box at the top to go straight to that queue. If a box shows nought, there is nothing of that kind waiting and nothing for you to do.',
    dashboardMaths:
      'Each box counts orders at one stage. The charts cover the last thirty days, ending today. "Who owes us" is what is unpaid right now, whatever period the chart shows.',

    ordersWhat:
      'Every order placed, and how far each one has got: waiting for a decision, being picked, packed, on the road, or delivered.',
    ordersUse:
      'Use the tabs to narrow the list to one stage, or search by the order reference such as ORD-2026-000001. Click any row to open the full order.',

    orderDetailWhat:
      'One order in full: who ordered it, what they asked for, what was agreed, and everything that has happened to it since.',
    orderDetailUse:
      'Read down the page for the history. The buttons at the top offer only what this order can do next, so if a button is missing the order is not at that stage yet.',
    orderDetailMaths:
      'Each line is quantity times the agreed price for that line, less any discount on it. The order total adds the lines, takes off any discount on the whole order, and adds the delivery charge.',

    orderEntryWhat:
      'Placing an order for a customer, for when a shop telephones instead of ordering themselves.',
    orderEntryUse:
      'Choose the shop first, then the address it goes to, then add each medicine and how many. Check the total at the bottom before you send it. The shop sees this exactly as if they had placed it.',
    orderEntryMaths:
      'Prices shown are the ordinary price for that customer. They are worked out again when the order is submitted, so if a price changes in between, the order uses the newer one.',

    cartWhat: 'The order you are putting together, before you send it.',
    cartUse:
      'Change any quantity, or remove a line you no longer want. Nothing is ordered and no stock is held until you go to checkout and send it.',
    cartMaths:
      'Each line is the quantity times the price for that medicine. The figure here is an estimate: the final price is set when the order is submitted.',

    checkoutWhat: 'The last step before an order is sent to the distributor.',
    checkoutUse:
      'Choose where it should be delivered and add a note if anything about it is unusual. Press the button once. If nothing seems to happen, wait rather than pressing again — pressing twice cannot create two orders, but waiting is quicker.',
    checkoutMaths:
      'The total is the lines, less any discount you have been given, plus delivery. It is confirmed by the distributor when they approve the order, and the confirmed figure is the one you will be invoiced for.',

    approvalsWhat:
      'Orders waiting for somebody to decide on them: whether the price is right, whether the quantity is right, and whether the customer has the credit for it.',
    approvalsUse:
      'Open the oldest first — a customer is waiting at the other end of each of these. Nothing is picked or reserved until you approve it.',

    approvalReviewWhat:
      'One order, with everything you need to decide on it: what was asked for, what it is worth, what the customer already owes, and whether their licence covers it.',
    approvalReviewUse:
      'Check each line, changing the quantity or price where you need to, then approve, hold, send back for clarification, or reject. Holding and rejecting both need a reason, and the customer reads that reason, so write it for them.',
    approvalReviewMaths:
      'Credit left is the customer’s limit less everything they already owe and less this order. If that comes out below nought, this order takes them past their limit and you are being told so before you approve it.',

    fulfilmentWhat:
      'Orders that have been approved and are waiting to be picked from the shelves, and the ones somebody is picking now.',
    fulfilmentUse:
      'Take the top of the queue unless something is urgent. Once you start one it is yours, and it stays yours until you finish it.',

    fulfilmentWorkWhat:
      'The pick list for one order: every line, the batch to take it from, and where that batch is.',
    fulfilmentWorkUse:
      'Work down the list. Scan or type each batch as you take it, and enter the number you actually took — not the number asked for. When every line is done, pack it, and the invoice is raised at that moment.',
    fulfilmentWorkMaths:
      'The batch offered is the one that expires soonest, so the oldest stock leaves first. If you pack fewer than were allocated, the rest goes back to available stock automatically.',

    fulfilmentReadyWhat: 'Orders that are packed and waiting for a rider to take them.',
    fulfilmentReadyUse:
      'Hand a package to a rider and record the handover here. Read the reference off the package in your hand rather than from the screen — the check exists to catch the wrong box.',

    deliveriesWhat: 'Who is carrying what, where it has got to, and what has arrived.',
    deliveriesUse:
      'Filter by rider or by state to find one delivery. This screen refreshes on its own, so leave it open on a wall and it stays current.',

    deliveryDetailWhat:
      'One delivery: what is in it, who is carrying it, and every step it has been through.',
    deliveryDetailUse:
      'Assign a rider if none is assigned yet. The rider records the rest from their phone as they go, so this page fills itself in.',

    tripsWhat: 'Delivery rounds: a rider, a day, and the stops they are making.',
    tripsUse: 'Open a round to see its stops in order, or plan a new one.',

    tripNewWhat: 'Planning one rider’s round for one day.',
    tripNewUse:
      'Choose the rider and the day, then add the stops. The order you add them in is the order they will be driven in, so add them in the order that makes sense on the road.',

    tripDetailWhat: 'One round, stop by stop, and how far along it the rider is.',
    tripDetailUse:
      'Follow the stops in order. This is the sheet a rider works from, so it prints cleanly if you would rather carry it on paper.',

    returnsWhat: 'Goods coming back from customers, and the credit raised against them.',
    returnsUse:
      'Open a request to decide it. Nothing is credited to the customer until somebody approves it here.',

    returnNewWhat: 'Asking to send goods back.',
    returnNewUse:
      'Choose the invoice they were bought on, tick the lines coming back and say how many of each, and say why. The reason decides whether the goods can be sold again, so be accurate rather than brief.',

    returnDetailWhat: 'One return: what is coming back, why, and what it was worth.',
    returnDetailUse:
      'Approve or refuse the request. Approving raises a credit note against the original invoice; refusing needs a reason the customer will read.',
    returnDetailMaths:
      'The credit is the quantity coming back at the price it was originally sold at, not at today’s price.',

    medicinesWhat: 'The catalogue: everything sold, and at what price.',
    medicinesUse:
      'Search by brand or generic name. Click any product to see its stock, its prices and its history.',

    medicineDetailWhat:
      'One product in full: what it is, what is on the shelf, and what it sells for.',
    medicineDetailUse:
      'Use Edit to change anything about the product. The price can be changed on its own without reopening the whole form.',
    medicineDetailMaths:
      'Margin is what the shop pays less what you paid, shown as a percentage of what the shop pays. Available stock is everything on hand less whatever is already promised to an order.',

    medicineNewWhat: 'Adding a product to the catalogue.',
    medicineNewUse:
      'Fill in the name, the pack and the prices. The hint under each box says what belongs in it, and the "i" beside a label explains what that box affects. Get "Sold as" right — it decides what a shop is ordering when they type 5.',
    medicineNewMaths:
      'What the shop pays may not be above the printed price on the pack. Nothing here is calculated for you; every price is the one you type.',

    medicineEditWhat: 'Changing a product already in the catalogue.',
    medicineEditUse:
      'Change what you need and save. Changing a price affects future orders only — orders already placed keep the price they were agreed at.',

    priceListsWhat:
      'Special prices for particular customers, for when one shop has agreed different rates from everybody else.',
    priceListsUse:
      'Open a list to see which prices it sets. A customer is put on a list from their own record, not from here.',

    priceListNewWhat: 'Creating a set of special prices.',
    priceListNewUse:
      'Give the list a name you will recognise later, set the dates it applies between, then add a line for each medicine and its price. Leave out anything that should stay at the ordinary price.',

    priceListDetailWhat: 'One set of special prices, and the medicines it covers.',
    priceListDetailUse:
      'Add, change or remove lines and save. It takes effect for orders placed from now on.',
    priceListDetailMaths:
      'A price here replaces the ordinary price for the customers on this list. If a customer is on a list and also has their own discount, the list price is used first.',

    schemesWhat: 'Free-goods offers: buy so many of something and get more of it at no charge.',
    schemesUse: 'Open an offer to see what it gives away and when it runs.',

    schemeNewWhat: 'Creating a free-goods offer.',
    schemeNewUse:
      'Choose the medicine, then say how many must be bought and how many are given free. Set the dates it runs between.',
    schemeNewMaths:
      'The free goods are worked out whole times only. On a buy ten get one offer, ordering twenty-five gives two free, not two and a half.',

    schemeDetailWhat:
      'One free-goods offer: what has to be bought, what is given free, and when it runs.',
    schemeDetailUse:
      'Change the quantities or the dates and save. Orders already placed are not changed.',

    inventoryWhat:
      'What is physically on the shelves: every batch, how much is left, what is promised to orders, and what is near expiry.',
    inventoryUse:
      'Search for a product to see its batches. Receive new stock here when a delivery arrives from a supplier.',
    inventoryMaths:
      'Available is what is on hand less what is already promised to orders. A batch that is blocked or expired counts in neither.',

    warehousesWhat: 'The places stock is kept.',
    warehousesUse: 'Add a warehouse before you receive stock into it.',

    warehouseNewWhat: 'Adding a place where stock is kept.',
    warehouseNewUse:
      'Give it a name and a code your team will recognise, and say where it is. The code is what appears on picking lists, so keep it short.',

    stocktakesWhat: 'Counts of what is actually on the shelves, against what the system thinks.',
    stocktakesUse: 'Open a count to enter figures, or start a new one.',

    stocktakeNewWhat:
      'Starting a count of what is actually on the shelves, so the system can be corrected to match.',
    stocktakeNewUse:
      'Choose which part of the warehouse to count, or leave it empty to count everything. Everything in scope goes on the sheet at the figures the system holds now, and those figures are hidden until you finish counting, so nobody can write down what they expected to find.',

    stocktakeDetailWhat: 'One count: what was expected, what was found, and the difference.',
    stocktakeDetailUse:
      'Enter what you counted for each line. When you post the count, stock is corrected to your figures and the difference is recorded against your name.',
    stocktakeDetailMaths:
      'The difference is what you counted less what the system expected. Over and short are shown separately rather than cancelling each other out, because two mistakes are not the same as no mistake.',

    recallWhat:
      'Given a batch number: who has it, and where it came from. For when a supplier issues a recall.',
    recallUse:
      'Type the batch number printed on the carton. Looking changes nothing, so check as often as you need.',

    controlledRegisterWhat:
      'What came in and what went out for every prescription medicine, and whether the arithmetic matches the shelf.',
    controlledRegisterUse:
      'Choose the period, then read down. This is the record an inspector asks for, so it is deliberately plain.',
    controlledRegisterMaths:
      'Closing balance is the opening balance, plus everything received, less everything issued. If that does not match what is on the shelf, the difference is a discrepancy somebody must explain.',

    suppliersWhat: 'The companies you buy from.',
    suppliersUse: 'Add a supplier before you can raise a purchase order to them.',

    supplierNewWhat: 'Adding a company you buy from.',
    supplierNewUse:
      'The company name and a telephone number are enough to start. Everything else can be added later.',

    purchaseOrdersWhat: 'What you have ordered from suppliers, and what has arrived.',
    purchaseOrdersUse: 'Open an order to record a delivery against it when it arrives.',

    purchaseOrderNewWhat: 'Ordering stock from a supplier.',
    purchaseOrderNewUse:
      'Choose the supplier, then add each medicine with how many and what you are paying for each. If the supplier is not on the list yet you can add them here without losing the lines you have typed.',
    purchaseOrderNewMaths:
      'Each line is the quantity times the cost each. This is what you pay, not what a shop pays.',

    purchaseOrderDetailWhat: 'One purchase order, and what has arrived against it.',
    purchaseOrderDetailUse:
      'When a delivery comes in, enter what actually arrived, its batch number and its expiry date. That is what puts the stock on the shelf and makes it sellable.',
    purchaseOrderDetailMaths:
      'Outstanding is what you ordered less what has arrived. A delivery can be short; the rest stays outstanding until it comes or you close the order.',

    paymentsWhat: 'Money received from customers.',
    paymentsUse:
      'Open a payment to see what it was put against. Record a new one when money comes in.',

    paymentNewWhat: 'Recording money received from a customer.',
    paymentNewUse:
      'Choose the shop, enter the amount and how it was paid, and say when it was received rather than when you are typing it. Attach the slip if you have one.',
    paymentNewMaths:
      'The amount is put against that shop’s oldest unpaid invoices first, unless you choose which invoices it should go against.',

    paymentDetailWhat: 'One payment: what was received, from whom, and what it was put against.',
    paymentDetailUse:
      'Reverse it if it was entered in error. Reversing does not delete anything — it records a correction, and both entries stay visible.',

    collectionsWhat: 'Cash riders have collected on their rounds, waiting to be checked in.',
    collectionsUse:
      'Count the cash against what the rider recorded, then check it in. It becomes a payment against the customer’s account only once you do.',
    collectionsMaths:
      'The rider’s figure and yours are kept separately. A difference between them is recorded rather than quietly overwritten.',

    reportOutstandingWhat: 'What every shop owes today.',
    reportOutstandingUse:
      'Sort by the largest to see who to telephone first. Export it if you want to work from it away from the screen.',
    reportOutstandingMaths:
      'What is owed is everything invoiced less everything paid and less any credit notes. Orders not yet invoiced are not counted.',

    reportOverdueWhat: 'What is past its due date, and by how long.',
    reportOverdueUse:
      'Work down from the oldest. The longer a debt sits, the less of it comes back.',
    reportOverdueMaths:
      'An invoice is overdue the day after its due date. The due date is the invoice date plus that customer’s agreed number of days.',

    reportCollectionsWhat: 'What has been collected, by whom, over a period.',
    reportCollectionsUse: 'Choose the dates, then read by person or by day.',
    reportCollectionsMaths:
      'Counted on the day the money was received, not the day it was typed in.',

    shopLedgerWhat:
      'One customer’s account: every charge, payment, credit and reversal, in the order they happened.',
    shopLedgerUse:
      'Read down to see how the balance got to where it is. Nothing here can be edited — a correction is a new entry, never a change to an old one.',
    shopLedgerMaths:
      'Each row moves the balance up or down, and the running balance is shown beside it. The last row is what they owe now.',

    shopStatementWhat: 'A customer’s account for one period, in the form you would send them.',
    shopStatementUse: 'Choose the period and print or export it.',
    shopStatementMaths:
      'Opening balance, plus what was invoiced in the period, less what was paid and credited, gives the closing balance.',

    analyticsWhat: 'Sales, stock and receivables at a glance.',
    analyticsUse:
      'Change the period at the top to look at any stretch of time. Each chart has a "figures behind this chart" line if you would rather read the numbers.',
    analyticsMaths:
      'Sales are counted from invoices, on the day the invoice is dated. Returns are shown separately rather than quietly taken off the sales figure.',

    analyticsSalesWhat: 'What has been bought and returned over time.',
    analyticsSalesUse:
      'Choose the period and whether to group by day, week or month. Break it down by medicine or by customer to see where the money came from.',
    analyticsSalesMaths: 'Net sales are what was invoiced less what was credited back on returns.',

    analyticsReturnsWhat: 'What is coming back, and why.',
    analyticsReturnsUse:
      'Look at the reasons before the totals. A rising count for one reason usually points at one supplier or one product.',

    analyticsInventoryWhat: 'Stock cover, movement and expiry risk.',
    analyticsInventoryUse:
      'Start with what is expiring, because that is the only part of this you cannot fix later.',
    analyticsInventoryMaths:
      'Stock value is counted at what you paid, not at what a shop pays, so it is what the stock cost you rather than what it might make.',

    analyticsDeliveriesWhat: 'How deliveries are performing.',
    analyticsDeliveriesUse: 'Compare riders and days to see where rounds are running late.',

    analyticsReceivablesWhat:
      'How the debt is ageing: how much is owed, and how long each part of it has been owed for.',
    analyticsReceivablesUse:
      'The further right a bar sits, the older the money is and the harder it will be to collect.',
    analyticsReceivablesMaths:
      'Each invoice sits in one band by how many days past its due date it is. Anything not yet due sits in "not yet due" rather than in a band.',

    shopsWhat: 'Your customers: their credit terms, their addresses and their licences.',
    shopsUse: 'Open a shop to see everything about it, or add one.',

    shopNewWhat: 'Adding a customer, so they can be ordered for and invoiced.',
    shopNewUse:
      'The name, a telephone number and at least one address are needed before they can order at all. Set the credit limit and the days to pay if they have been agreed.',

    shopDetailWhat: 'One customer: what they owe, what they may order, and what they have ordered.',
    shopDetailUse:
      'Change their terms, addresses or licence here. Their account history is on the account page.',
    shopDetailMaths:
      'Credit available is their limit less what they already owe. When that reaches nought, new orders are held for a decision rather than refused outright.',

    usersWhat: 'People who can sign in, and what each of them may do.',
    usersUse:
      'Change somebody’s role to change what they can reach. Deactivate rather than delete when somebody leaves — their past actions must stay attributable.',

    userNewWhat: 'Adding somebody who can sign in.',
    userNewUse:
      'Their name, their email address and their role. The role decides everything they can see and do, so pick the narrowest one that lets them do their job. They set their own password the first time they sign in.',

    settingsWhat: 'Tax, credit, expiry windows, notifications and how your documents look.',
    settingsUse:
      'Change a setting and save. These apply across the whole business immediately, so read what a box does before changing it.',

    auditWhat: 'Every action that matters, who took it and when.',
    auditUse:
      'Filter by person, by kind of action or by date. Nothing here can be changed or removed, by anybody, which is what makes it worth having.',

    activityWhat: 'What has happened recently, across the business.',
    activityUse: 'A running list, newest first. Use it to catch up after a day away.',

    shopAccountWhat: 'What you owe, what credit you have left, and your invoices.',
    shopAccountUse: 'Open any invoice to see or print it. Your payments are on their own page.',
    shopAccountMaths:
      'What you owe is everything invoiced less everything you have paid and less any credit notes. Credit left is your limit less what you owe.',

    myPaymentsWhat: 'Payments recorded against your account.',
    myPaymentsUse:
      'Check these against your own records. If something is missing, it may not have been checked in yet.',

    myPaymentDetailWhat: 'One payment, and the invoices it was put against.',
    myPaymentDetailUse: 'Keep the reference if you need to ask about this payment later.',

    myStatementWhat: 'Your account, period by period.',
    myStatementUse: 'Choose the period and print or export it for your own books.',
    myStatementMaths:
      'Opening balance, plus what you were invoiced, less what you paid and were credited, gives the closing balance.',

    notificationsWhat: 'Everything the system has told you.',
    notificationsUse: 'Unread ones are marked. Opening one takes you to whatever it is about.',

    notificationPreferencesWhat: 'Which things you are told about, and how.',
    notificationPreferencesUse:
      'Turn off anything you do not need. Turning something off here stops the message reaching you; it does not stop the thing happening.',

    securityWhat: 'Where you are signed in, and how to sign out elsewhere.',
    securityUse:
      'If you see a sign-in you do not recognise, sign it out and change your password. Signing out elsewhere does not sign you out here.',

    changePasswordWhat: 'Changing your own password.',
    changePasswordUse:
      'Your current password, then the new one twice. You stay signed in here; anywhere else you are signed in is signed out.',
  },

  hints: {
    addressLine2: 'A second line, if the address needs one. You can leave this empty.',
    postalCode: 'The post code, if the area has one. You can leave this empty.',
    supplierName: 'The company name as it appears on their invoices.',
    supplierContact: 'The person you deal with there.',
    supplierPhone: 'A number somebody answers during working hours.',
    supplierEmail: 'Where purchase orders will be sent.',
    supplierLicence:
      'Their drug licence number. You need it to buy prescription medicines from them.',
    supplierLicenceExpiry: 'When their licence runs out. You will be warned before it does.',
    supplierPaymentTerms: 'How many days you have to pay them after an invoice.',
    dateFrom: 'The first day to include.',
    dateTo: 'The last day to include.',
    asOf: 'The figures are worked out as they stood at the end of this day.',
    statusFilter: 'Show only records at this stage. Leave it on All to see everything.',
    searchReference: 'Part of a reference is enough — you need not type all of it.',
    notesInternal: 'Only your own team sees this. The customer does not.',
    notesOptional: 'Anything worth recording later. You can leave this empty.',
    groupBy: 'Whether each point on the chart is a day, a week or a month.',
    auditAction: 'Show only one kind of action. Leave it empty to see all of them.',
    auditEntity: 'Show only actions taken on one kind of record.',
    paymentMethodFilter: 'Show only payments made one way.',
    showInactive: 'Include suppliers you have stopped using.',
    searchDeliveries: 'Search by order reference, shop name or rider.',
    searchMedicines: 'Search by brand name, generic name or your own stock code.',
    searchShops: 'Search by shop name, code or telephone number.',
    searchUsers: 'Search by name or email address.',
    roleFilter: 'Show only people with one role.',
    userStatusFilter: 'Show only active accounts, or only deactivated ones.',
    loginEmail: 'The address your account was set up with.',
    loginPassword: 'If you have forgotten it, ask an administrator to reset it.',
    currentPassword: 'The password you use now, so we know it is you.',
    repeatPassword: 'Type the new password again. The two must match exactly.',
    orderDiscount: 'Money off the whole order, on top of any discount on a single line. In taka.',
    deliveryCharge:
      'What the customer is charged to have this delivered. In taka. Put 0 if it is free.',
    shopNotes: 'The customer reads this, so write it for them.',
    deliveryAddress:
      'Where this order should be delivered. Add a new one if it is going somewhere different this time.',
    paymentMethodIntent: 'How you intend to pay. You can still change this when it arrives.',
    deliveryNotes: 'Anything the rider needs to know — a gate code, or a better time to come.',
    orderQuantity:
      'How many the shop wants. Check whether this is sold by the box or by the strip before typing a number.',
    packageCount: 'How many separate boxes this order is going into. Each one gets its own label.',
    packingNotes: 'Anything the rider or the shop should know about how it is packed.',
    reportLine: 'Which line on the pick list has the problem.',
    reportType: 'What is wrong with it — short, damaged, or not found on the shelf.',
    affectedQuantity: 'How many units the problem affects, not the size of the whole line.',
    discrepancyNotes:
      'What you found, in enough detail that whoever decides on it later does not have to ask.',
    adjustReason:
      'Why this is being changed. It is kept with the record and cannot be removed later.',
    productType:
      'Which shelf this sits on. It changes nothing about pricing or stock; it is for browsing and reporting.',
    classification:
      'Whether this is dispensed against a prescription. Choosing Prescription makes the generic name, strength and form required.',
    productDescription: 'Shown to shops on the product page. Not for internal notes.',
    priceListName:
      'A name you will recognise later, such as the customer or the agreement it came from.',
    validTo: 'The last day it applies. Leave it empty for no end date.',
    activeOnly: 'Only an active one is used when an order is priced.',
    listUnitPrice: 'What this customer pays for one, in taka. It replaces the ordinary price.',
    discountPercent:
      'Money off as a percentage, if you would rather set it that way than type a price.',
    schemeName: 'A name you will recognise later, such as "Napa, October".',
    freeQuantity: 'How many are given free once the buying quantity is reached.',
    supplierInvoiceRef:
      'The number on the supplier’s own invoice, so the two can be matched later.',
    batchNumber: 'The batch number printed on the carton. It is what a recall is traced by.',
    manufacturingDate: 'The date printed on the pack.',
    expiryDate:
      'The date on the pack. Stock is sold oldest first, so this decides what leaves next.',
    receivedQuantity: 'How many actually arrived, not how many were ordered.',
    warehouseLocation: 'Where this batch is being put, so a picker can find it.',
    supplierBatchRef:
      'The supplier’s own reference for this batch, if it differs from the batch number.',
    unitCost: 'What you pay for one, in taka. This is your cost, not what a shop pays.',
    expectedDate: 'When you expect the supplier to deliver.',
    orderQuantitySupplier: 'How many you are ordering.',
    supplierAddress: 'Where they are, for the paperwork.',
    againstInvoice:
      'Choose an invoice to put this against, or leave it and the oldest unpaid ones are used first.',
    paymentMethodReceived: 'How the money was received.',
    whenCollected: 'When the money was actually received, not when you are typing it in.',
    returnInvoice: 'The invoice these goods were bought on.',
    returnReason: 'Why they are coming back. This decides whether they can be sold again.',
    notesForSupplier: 'Anything the distributor needs to know about the condition of the goods.',
    reviewNotes: 'What you checked and what you decided. Kept with the return.',
    rejectionReason: 'Why it is being refused. The customer reads this.',
    expectedDelivery: 'The day the customer has been told to expect it.',
    priority: 'Urgent rounds are driven first. Leave it as normal unless there is a reason.',
    riderInstructions: 'Anything the rider needs to know before they set off.',
    tripDay: 'The day this round will be driven.',
    vehicle: 'Which vehicle, for your own records.',
    stocktakeNotes: 'Why this count is being taken, if there is a reason worth recording.',
    warehouseName: 'What your team calls this place.',
    warehouseAddress: 'Where it is.',
    city: 'The city or town it is in.',
    district: 'The district it is in.',
    contactPhone: 'A number to ring if a delivery cannot be made.',
    firstName: 'Their given name, as they would write it themselves.',
    lastName: 'Their family name.',
    userRole:
      'What they will be able to see and do. Pick the narrowest one that lets them do their job.',
    roleForUser: 'Changing this changes what they can see and do, straight away.',
    statusForUser:
      'Deactivating stops them signing in. Everything they have already done stays on the record.',
    quietFrom: 'The time messages stop reaching you at night.',
    quietTo: 'The time messages start reaching you again in the morning.',
    quietFromAll: 'The time messages stop reaching people at night.',
    quietToAll: 'The time messages start reaching people again in the morning.',
    settingValue: 'This applies across the whole business as soon as it is saved.',
  },

  errorPages: {
    notFoundTitle: 'That page does not exist',
    /*
     * Split in two, because the single sentence ended "You are still signed
     * in." and was shown to everybody — including a visitor who was not signed
     * in, standing in front of a button that took them to the sign-in form.
     */
    notFoundBody: 'The address may have been mistyped, or the page may have moved.',
    notFoundSignedIn: 'You are still signed in.',
    notFoundSignedOut: 'Sign in and we will take you to your own home screen.',
    forbiddenTitle: 'You cannot open this page',
    forbiddenBody: 'Your account does not have access to it. Ask an administrator if you need it.',
    backToDashboard: 'Back to your home screen',
  },

  /**
   * The vocabulary every page shares.
   *
   * Zero of the 53 web pages called the translation function, so the switch
   * changed the shell and nothing inside it. Most of what those pages say is
   * not bespoke — it is "Add", "Status", "Showing 1–50 of 384" — and putting
   * that here first means converting a page is mostly wiring rather than
   * writing, and that two pages cannot end up with "Delete" and "Remove" for
   * the same button.
   */
  actions: {
    add: 'Add',
    edit: 'Edit',
    view: 'View',
    remove: 'Remove',
    create: 'Create',
    submit: 'Submit',
    confirm: 'Confirm',
    approve: 'Approve',
    reject: 'Reject',
    refresh: 'Refresh',
    export: 'Export',
    print: 'Print',
    back: 'Back',
    apply: 'Apply',
    clear: 'Clear',
    filter: 'Filter',
    reason: 'Reason',
    reasonTooShort:
      'Please give a reason of at least {{minimum}} characters, so the record explains itself later.',
    // A destructive action names what it destroys at the call site; this is
    // only the verb.
    delete: 'Delete',
  },

  /**
   * Column headings and field labels. One word per concept across every
   * screen — a "Reference" is never a "Ref" on the next page.
   */
  fields: {
    reference: 'Reference',
    date: 'Date',
    status: 'Status',
    quantity: 'Quantity',
    amount: 'Amount',
    total: 'Total',
    customer: 'Customer',
    shop: 'Shop',
    medicine: 'Medicine',
    brand: 'Brand',
    batch: 'Batch',
    expiry: 'Expiry',
    price: 'Price',
    notes: 'Notes',
    phone: 'Phone',
    email: 'Email address',
    address: 'Address',
    createdBy: 'Created by',
    createdAt: 'Created',
    dueDate: 'Due',
    outstanding: 'Outstanding',
  },

  /**
   * A form that is not finished being filled in.
   *
   * Separate from `errors` on purpose. Nothing here describes a malfunction —
   * it describes a form that still needs something, which is an ordinary part
   * of filling one in and should not be worded as a fault.
   */
  forms: {
    notReady: 'This is not ready to be saved yet',
    takeMeThere: 'Take me there',
  },

  /** Lists, tables and the things said around them. */
  lists: {
    searchPlaceholder: 'Search…',
    noResults: 'Nothing matched that search',
    noResultsBody: 'Check the spelling, or clear the filters and try again.',
    showing: 'Showing {{first}}–{{last}} of {{total}}',
    previous: 'Previous',
    next: 'Next',
    pagination: 'Pagination',
    loadingList: 'Loading {{what}}',
    couldNotLoad: 'This could not be loaded.',
  },

  /**
   * The ordering journey, which is the path most of this product's users walk
   * most weeks — catalogue, order, send, then read it back.
   */
  catalogue: {
    title: 'Medicines',
    subtitle: 'Browse what is available and add it to your order.',
    searchLabel: 'Search the catalogue',
    searchPlaceholder: 'Brand, generic, manufacturer, SKU or barcode',
    addMedicine: 'Add a medicine',
    stock: 'Stock',
    loading: 'Loading medicines',
    couldNotLoad: 'The catalogue could not be loaded.',
    none: 'No medicines matched',
    noneBody: 'Try a shorter search — a brand name on its own usually finds it.',
    available: 'In stock',
    outOfStock: 'Out of stock',
    addToOrder: 'Add to order',
    listedActive: 'Available to order',
    listedInactive: 'Not available',
    back: 'Back to the catalogue',
    about: 'About this medicine',
    productType: 'Product type',
    manufacturer: 'Manufacturer',
    category: 'Category',
    classification: 'Classification',
    coldChain: 'Needs refrigeration',
    yes: 'Yes',
    no: 'No',
    orderLimits: 'How many you may order',
    noMaximum: 'no maximum',
    /*
     * "List price", not "Your price".
     *
     * The catalogue serves the medicine's standard trade price, while an order
     * is charged through `resolvePriceFrom` — the shop's own discount first,
     * then its assigned price list, then this. For any customer with either,
     * the figure on this screen is not the one they pay, and calling it "your
     * price" made the page state something untrue.
     */
    listPrice: 'List price',
    listPriceNote: 'Your own price is confirmed when you place the order.',
    availability: 'Availability',
    loadingOne: 'Loading this medicine',
    couldNotLoadOne: 'This medicine could not be loaded.',
    batches: 'Stock on hand',
    manageStock: 'Manage stock',
    noBatches: 'No stock has been received yet.',
    reserved: 'Reserved',
    packSize: 'Pack size',
    location: 'Where it is',
  },

  /**
   * Managing one medicine from its own page.
   *
   * Four of these actions call endpoints that had never had a caller anywhere
   * in this product: correcting a count, blocking a batch, changing a price
   * without retyping the whole record, and reading a medicine's own stock
   * history. The wording carries the weight the buttons cannot — "take off the
   * catalogue" rather than "delete", because nothing is deleted and every past
   * order still names it.
   */
  medicinePage: {
    edit: 'Edit',
    delist: 'Take off the catalogue',
    list: 'Put back on the catalogue',
    delistTitle: 'Take this off the catalogue?',
    delistBody:
      '{{brand}} will stop appearing to shops and cannot be ordered. Orders already placed are not affected, and you can put it back at any time.',
    listTitle: 'Put this back on the catalogue?',
    listBody: 'Shops will be able to see and order {{brand}} again.',
    delisted: 'It is off the catalogue.',
    listed: 'It is back on the catalogue.',
    pricing: 'Price',
    margin: 'Margin',
    marginNote: 'What a shop makes against the price printed on the pack.',
    noMrp: 'No printed price recorded',
    noMrpSet: 'Not recorded',
    perUnit: 'For one {{unit}}',
    priceOrder:
      'An order uses this price unless the shop has its own discount or a price list, and both of those come first.',
    newPrice: 'New price for a shop',
    newPriceHint: 'In taka. It applies to every order placed from now on.',
    changePrice: 'Change the price',
    priceChanged: 'The price is now {{amount}}.',
    aboveMrp: 'The price cannot be above the price printed on the pack.',
    onPriceLists: 'Price lists carrying this',
    noPriceLists: 'No price list names this medicine, so every shop pays the price above.',
    offers: 'Free-goods offers',
    noOffers: 'No offer is running on this medicine.',
    history: 'Stock history',
    receiveInto: 'This stock goes against {{brand}}.',
    correctCount: 'Correct the count',
    correctTitle: 'Correct the counted stock',
    correctBody:
      'Batch {{batch}} is recorded as {{recorded}}. Enter what is actually on the shelf.',
    countedLabel: 'What you counted',
    badCount: 'Enter a whole number, zero or more.',
    correctIt: 'Correct it',
    correctWhy:
      'This replaces the recorded count, so the reason is all anybody reading it later has to go on.',
    corrected: 'Batch {{batch}} has been corrected.',
    block: 'Block',
    unblock: 'Unblock',
    blockTitle: 'Block this batch',
    blockBody: 'Nothing from batch {{batch}} can be picked or sold while it is blocked.',
    unblockTitle: 'Unblock this batch',
    unblockBody: 'Batch {{batch}} can be picked and sold again.',
    blocked: 'The batch is blocked.',
    unblocked: 'The batch is available again.',
  },

  cart: {
    title: 'Your order',
    subtitle: 'Nothing is set aside until a manager approves it.',
    keepBrowsing: 'Keep browsing',
    empty: 'Your order is empty',
    emptyBody: 'Add medicines from the catalogue and they will appear here.',
    browse: 'Browse medicines',
    unitPrice: 'Unit price',
    lineTotal: 'Line total',
    quantityFor: 'How many {{brand}}',
    minimum: 'At least {{minimum}}',
    minimumAndMaximum: 'At least {{minimum}}, at most {{maximum}}',
    subtotal: 'Estimated subtotal',
    discount: 'Discount',
    total: 'Estimated total',
    freeGoods: '{{count}} free with this',
    pricing: 'Checking your prices',
    loading: 'Opening your order',
    deliveryCharge: 'Delivery',
    estimateNote:
      'This is what you would pay today. A manager confirms it when they approve the order.',
    couldNotPrice: 'Your prices could not be checked just now.',
    saveDraft: 'Save for later',
    draftSaved: 'Saved. You can come back to this order later.',
    checkout: 'Review and send',
    addedToOrder: '{{brand}} added to your order.',
    draftFailed: 'That could not be saved. Try again.',
    remove: 'Remove',
    removed: '{{brand}} removed from your order.',
  },

  checkout: {
    title: 'Send your order',
    subtitle: 'Prices, limits and stock are checked once more when you send it.',
    empty: 'There is nothing to send',
    emptyBody: 'Add medicines to your order first.',
    deliveryAddress: 'Where should it go?',
    selectAddress: 'Choose an address',
    couldNotLoadAddresses: 'Your delivery addresses could not be loaded.',
    paymentMethod: 'How you plan to pay',
    purchaseOrder: 'Your purchase-order number',
    purchaseOrderHint:
      'Optional. It is printed on the invoice so you can match it to your own paperwork.',
    deliveryNotes: 'Anything the rider should know',
    submit: 'Send this order',
    submitting: 'Sending…',
    whatYouWillPay: 'What you will pay',
    failed: 'Your order could not be sent.',
  },

  orders: {
    title: 'Orders',
    subtitle: 'Every order you have placed, newest first.',
    start: 'Start an order',
    loading: 'Loading your orders',
    couldNotLoad: 'Your orders could not be loaded.',
    none: 'No orders yet',
    noneBody: 'Browse the catalogue and add what you need — an order starts there.',
    itemCount: 'Items',
    estimate: 'Estimate',
    loadingOne: 'Loading this order',
    couldNotLoadOne: 'This order could not be loaded.',
    submitted: 'Your order has been sent for approval.',
    repeat: 'Order this again',
    requestCancellation: 'Ask to cancel',
    trackDelivery: 'Track the delivery',
    all: 'All orders',
    cancellationRequested: 'You have asked for this order to be cancelled.',
    whatYouOrdered: 'What you ordered',
    estimatedTotal: 'Estimated total',
    timeline: 'What has happened so far',
    activity: 'Order activity',
    cancelTitle: 'Ask to cancel this order',
    cancelBody:
      'A manager decides cancellations. You will be told whether yours was granted, and the order carries on in the meantime.',
    cancelLabel: 'Why do you want to cancel it?',
    cancelConfirm: 'Send the request',
  },

  returns: {
    moreThanApproved: 'Only {{approved}} were agreed for return.',
    expiredCannotRestock: 'This batch has expired, so none of it can go back on the shelf.',
    titleOwner: 'Your returns',
    titleStaff: 'Customer returns',
    subtitleOwner:
      'Send goods back against a delivered invoice and follow it through to the credit note.',
    subtitleStaff: 'Review, receive and credit returned goods.',
    request: 'Request a return',
    loading: 'Loading returns',
    couldNotLoad: 'Returns could not be loaded.',
    forbidden: 'Your account cannot see returns.',
    none: 'No returns yet',
    noneBody: 'A return starts from a delivered invoice.',
    noneFiltered: 'No returns match these filters',
    allStatuses: 'Any status',
    referenceHint: 'RET-2026-000001',
    columnReturn: 'Return',
    columnInvoice: 'Invoice',
    columnRequested: 'Requested',
    columnReason: 'Reason',
    columnValue: 'Value',
    requestTitle: 'Request a return',
    requestSubtitle: 'Choose a delivered invoice, then the items and quantities to send back.',
    loadingInvoices: 'Loading your invoices',
    couldNotLoadInvoices: 'Your invoices could not be loaded.',
    cannotRequest: 'Your account cannot request returns.',
    noInvoices: 'You have no invoices yet',
    noInvoicesBody: 'There is nothing to return until an invoice has been issued.',
    invoice: 'Invoice',
    selectInvoice: 'Choose an invoice',
    mainReason: 'Main reason',
    loadingLines: 'Loading the items on that invoice',
    couldNotLoadLines: 'The items on that invoice could not be loaded.',
    noLines: 'That invoice has nothing that can be returned.',
    columnItem: 'Item',
    columnInvoiced: 'How many were sent',
    columnReturnQuantity: 'How many to send back',
    quantityFor: 'How many {{brand}} to send back',
    reasonFor: 'Why {{brand}} is coming back',
    expires: 'Expires {{date}}',
    notesForSupplier: 'Anything we should know',
    estimate: 'Estimated credit if all of it is approved: {{amount}}',
    estimateBody: 'The final credit is worked out from the goods actually received and inspected.',
    needQuantity: 'Enter a quantity for at least one item.',
    tooMany: 'You can send back at most {{maximum}} of {{brand}}.',
    submit: 'Send this request',
    submitting: 'Sending…',
    submitFailed: 'This return request could not be sent.',
  },

  /** Picking, packing and the shelf. */
  fulfilment: {
    title: 'Picking and packing',
    subtitle: 'Pick, settle any differences, pack, then hand over.',
    readyLink: 'Ready to hand over',
    backToPicking: 'Back to picking',
    filter: 'Which work',
    loading: 'Loading the queue',
    couldNotLoad: 'The queue could not be loaded.',
    none: 'Nothing in this queue',
    noneBody: 'Approved orders appear here when they are ready to be picked.',
    lines: '{{count}} batch lines to pick',
    open: 'Open',
    readyTitle: 'Ready to hand over',
    readySubtitle: 'Packed and invoiced. Open one to hand it to the delivery person.',
    readyLoading: 'Loading the packages that are ready',
    readyCouldNotLoad: 'The packages that are ready could not be loaded.',
    readyNone: 'Nothing is waiting to go out',
    readyNoneBody: 'Packages appear here once they have been packed and invoiced.',
    goToPicking: 'Go to the picking queue',
    packages: '{{count}} packages',
    onePackage: '1 package',
    barcode: 'Barcode {{code}}',
    barcodeLabel: 'Barcode',
    handOver: 'Hand over',
  },

  settings: {
    title: 'Settings',
    subtitle:
      'Saved values take effect at once. Documents already issued keep the values they were issued with.',
    reload: 'Reload',
    loading: 'Loading settings',
    couldNotLoad: 'The settings could not be loaded.',
    groupLabel: 'Which settings',
    save: 'Save these settings',
    saving: 'Saving…',
    saved: '{{group}} saved.',
    saveFailed: 'These settings could not be saved.',
    stale: 'Somebody else changed these settings. The latest values have been reloaded.',
    resetToFallback: 'Go back to the built-in values',
    resetTitle: 'Reset {{group}}?',
    resetBody:
      'The saved values are discarded and the built-in or environment values take over. The discarded values stay in the audit log.',
    resetLabel: 'Why is this being reset?',
    resetConfirm: 'Reset these settings',
    resetDone: '{{group}} is back on its built-in values.',
    resetFailed: 'These settings could not be reset.',
    discard: 'Undo my changes',
    sourceLabel: 'Where these values come from',
    quietHours: 'Default quiet hours',
    quietEnabled: 'On for anyone who has not chosen their own',
    from: 'From',
    to: 'To',

    groupBusiness: 'The business',
    groupFinance: 'Money and credit',
    groupInventory: 'Stock limits',
    groupDelivery: 'Delivery proof',
    groupNotifications: 'Notification defaults',
    groupLocalisation: 'Language and formats',
    groupSecurity: 'Security',

    sourcePERSISTED: 'Saved here',
    sourceENVIRONMENT: 'From the environment',
    sourceDEFAULT: 'Built-in default',

    fieldName: 'Display name',
    fieldLegalName: 'Legal name',
    fieldLogoUrl: 'Logo address',
    fieldAddress: 'Address',
    fieldPhone: 'Phone',
    fieldEmail: 'Email address',
    fieldWebsite: 'Website',
    fieldTradeLicenceNumber: 'Trade licence number',
    fieldDrugLicenceNumber: 'Drug licence number',
    fieldInvoiceFooter: 'Printed at the foot of every invoice',
    fieldTaxBasisPoints: 'Tax rate, in hundredths of a percent (750 = 7.50%)',
    fieldDefaultPaymentTermsDays: 'Days a new customer gets to pay',
    fieldCreditBlockOnLimitExceeded: 'Refuse orders once the credit limit is passed',
    fieldCreditBlockOverdueThresholdMinor: 'Refuse orders once this much is overdue',
    fieldCreditOverdueGraceDays: 'Days of grace before an invoice counts as overdue',
    fieldCustomerAdvanceEnabled: 'Let customers pay in advance',
    fieldDeliveryCollectionRequiresVerification:
      'Cash a rider collects must be checked before it posts',
    fieldNearExpiryDays: 'Days before expiry that counts as close',
    fieldLowStockThreshold: 'Units left that counts as running low',
    fieldRequiredProofs: 'Proof a rider must capture',
    fieldOtpExpiryMinutes: 'How long a delivery code lasts, in minutes',
    fieldOverdueDigestEnabled: 'Send the daily overdue summary',
    fieldNearExpiryDigestEnabled: 'Send the daily near-expiry summary',
    fieldTimezone: 'Time zone',
    fieldLocale: 'Language',
    fieldDateFormat: 'How dates are written',
    fieldCurrencyCode: 'Currency code',
    fieldCurrencySymbol: 'Currency symbol',
    fieldPasswordMinLength: 'Shortest password allowed',
    fieldMaxLoginAttempts: 'Wrong sign-ins before the account locks',
    fieldLockoutMinutes: 'Minutes an account stays locked',
    fieldForcePasswordChangeOnCreate: 'Make new people choose their own password',
  },

  security: {
    title: 'Your sign-ins',
    subtitle:
      'Every device signed in to your account. Sign one out if you do not recognise it, or if you have lost it.',
    signOutEverywhere: 'Sign out everywhere',
    signingOut: 'Signing out…',
    loading: 'Loading your sign-ins',
    couldNotLoad: 'Your sign-ins could not be loaded.',
    none: 'No sign-ins recorded',
    noneBody: 'This account has never been signed in to.',
    whereSignedIn: 'Where you are signed in',
    device: 'Device',
    thisDevice: 'This device',
    ipAddress: 'Address',
    signedIn: 'Signed in',
    lastUsed: 'Last used',
    state: 'State',
    active: 'Active',
    signOut: 'Sign out',
    signOutThisTitle: 'Sign out of this device?',
    signOutThisBody: 'You will have to sign in again.',
    signOutOtherTitle: 'Sign out of that device?',
    signOutOtherBody: 'It stops working on its next request rather than at the end of its session.',
    signOutAllTitle: 'Sign out of every device, including this one?',
    signOutAllBody: 'You will have to sign in again here as well.',
    signedOutThis: 'This device was signed out.',
    signedOutOther: 'That device was signed out.',
    signedOutAll: 'Signed out of {{count}} devices.',
    signOutFailed: 'That device could not be signed out.',

    /**
     * Naming a device, and why one stopped working.
     *
     * Both clients held their own copy of these sentences in English, so the
     * one screen whose whole job is "do you recognise this?" answered in a
     * language the person might not read. `Chrome`, `Android` and the rest are
     * proper nouns and are not translated.
     */
    deviceOn: '{{client}} on {{platform}}',
    unknownDevice: 'Unknown device',
    unknownClient: 'Unknown app',
    unknownPlatform: 'Unknown kind of device',
    endedTokenReuse: 'Ended for safety',
    endedRevokedByAdmin: 'Ended by an administrator',
    endedRoleChanged: 'Ended after a role change',
    endedSignedOutEverywhere: 'Signed out everywhere',
    endedSignedOut: 'Signed out',
    immediate:
      'Signing a device out takes effect at once: it stops working on its next request rather than at the end of its session.',
    deployment: 'This installation',
    deploymentBody:
      'What this instance is running and how its protections are set. Read-only, and no secret is shown — only whether one is set.',
    deploymentUnavailable:
      'The installation details could not be read. Your sign-ins are unaffected.',
    version: 'Version',
    environment: 'Environment',
    uptime: 'Running for',
    database: 'Database',
    pool: 'pool {{size}}',
    rateLimiting: 'Request limits',
    shared: 'shared',
    perInstance: 'per instance',
    window: '{{seconds}}s window',
    signInBudget: 'Sign-ins allowed',
    writeBudget: 'Writes allowed',
    reportBudget: 'Reports allowed',
    perWindow: '{{count}} per window',
    accessToken: 'Session length',
    minutes: '{{count}} minutes',
    refreshToken: 'Stay signed in for',
    days: '{{count}} days',
    separateSecret: 'Separate refresh secret',
    derived: 'Derived from the main secret',
    trustedProxies: 'Trusted proxies',
    realtime: 'Live updates',
    notificationQueue: 'Notification queue',
    bodyLimit: 'Request size limit',
    uploadLimit: 'Upload size limit',
  },

  users: {
    title: 'People',
    subtitle: 'Who works here, what they can do, and their sign-ins. Every change is recorded.',
    reload: 'Reload',
    searchLabel: 'Find someone',
    searchPlaceholder: 'Name or email address',
    roleFilter: 'Role',
    anyRole: 'Any role',
    statusFilter: 'Status',
    anyStatus: 'Any status',
    loading: 'Loading people',
    couldNotLoad: 'The people could not be loaded.',
    none: 'Nobody matches this filter',
    noneBody: 'Try a shorter search, or clear the filters.',
    you: 'you',
    passwordChangePending: 'must choose a new password',
    lastSignedIn: 'last signed in {{when}}',
    neverSignedIn: 'never signed in',
    roleFor: 'Role for {{email}}',
    statusFor: 'Status for {{email}}',
    readOnly: 'You can see this but not change it',
    roleChanged: '{{email}} is now a {{role}}.',
    statusChanged: '{{email}} is now {{status}}.',
    updateFailed: 'That account could not be updated.',
    resetPassword: 'Reset their password',
    resetTitle: 'Reset the password for {{name}}',
    resetBody:
      'They will be asked to choose their own password the next time they sign in, and every device they are signed in on will be signed out.',
    temporaryPassword: 'Temporary password',
    temporaryPasswordHint:
      'At least {{minimum}} characters. Read it to them — it is shown only now.',
    tooShort: 'Use at least {{minimum}} characters.',
    resetWhyTitle: 'Why is this password being reset?',
    resetWhyBody: 'This is recorded against your name.',
    resetDone: 'Password reset for {{email}}. Every session was signed out.',
    resetFailed: 'That password could not be reset.',
    signOutSessions: 'Sign them out everywhere',
    signOutTitle: 'Sign {{email}} out everywhere?',
    signOutBody:
      'Every device they are signed in on is signed out at once. They can sign back in with the same password.',
    signOutConfirm: 'Sign them out',
    signOutDone: 'Signed out {{count}} sessions for {{email}}.',
    signOutFailed: 'Those sessions could not be signed out.',
  },

  audit: {
    title: 'Audit log',
    subtitle: 'A permanent record of sensitive actions. Nothing here can be edited or removed.',
    reload: 'Reload',
    action: 'What was done',
    allActions: 'Anything',
    entityType: 'To what',
    entityHint: 'Order, Payment, User…',
    loading: 'Loading the audit log',
    couldNotLoad: 'The audit log could not be loaded.',
    none: 'Nothing matches this filter',
    noneBody: 'Try a wider date range, or clear the filters.',
    showDetail: 'Show what changed',
    hideDetail: 'Hide what changed',
    noDetail: 'Nothing recorded beyond the action itself',
    unknownActor: 'Not recorded',
  },

  shops: {
    priceList: 'Price list',
    priceListHint: 'Which list this customer is charged from.',
    priceListDefault: 'The default list',
    priceListTruncated:
      'Showing {{shown}} of {{total}} price lists. Open the price list screen to see the rest.',
    title: 'Shops',
    subtitle: 'Every pharmacy we supply, and how much credit each one has.',
    add: 'Add a shop',
    searchLabel: 'Find a shop',
    searchPlaceholder: 'Name, phone or reference',
    statusFilter: 'Status',
    anyStatus: 'Any status',
    loading: 'Loading shops',
    couldNotLoad: 'The shops could not be loaded.',
    none: 'No shops matched',
    noneBody: 'Try a shorter search, or add the shop.',
    name: 'Name',
    territory: 'Area',
    creditLimit: 'Credit limit',
    licenceExpiry: 'Licence expires',
    licenceSoon: 'Expires soon',
    addTitle: 'Add a shop',
    addSubtitle: 'The name, who to call, and what credit they get.',
    back: 'Back to the shops',
    shopName: 'Shop name',
    primaryPhone: 'Main phone number',
    primaryPhoneHint: '+8801XXXXXXXXX',
    alternativePhone: 'Another number',
    email: 'Email address',
    drugLicenceNumber: 'Drug licence number',
    drugLicenceExpiry: 'Drug licence expires',
    creditLimitHint: 'In taka, for example 50000.00.',
    paymentTerms: 'Days to pay',
    internalNotes: 'Internal notes',
    create: 'Create the shop',
    creating: 'Creating…',
    createFailed: 'The shop could not be created.',
    badAmount: 'Enter an amount like 50000.00.',
    loadingOne: 'Loading this shop',
    couldNotLoadOne: 'This shop could not be loaded.',
    contact: 'Who to contact',
    trading: 'Trading',
    ledger: 'Account',
    statement: 'Statement',
    addresses: 'Delivery addresses',
    noAddresses: 'No delivery address on file.',
    owners: 'Who can order',
    noOwners: 'Nobody can order for this shop yet.',
    outstanding: 'Owed now',
    availableCredit: 'Credit left',
    licence: 'Drug licence',
    tradeLicence: 'Trade licence',
    noLicence: 'Not recorded',
    licenceWarning: 'The drug licence expires on {{date}}.',
    statusControls: 'Change what they can do',
    activate: 'Let them trade',
    suspend: 'Stop them trading',
    blockCredit: 'Block their credit',
    deactivate: 'Make inactive',
    activateTitle: 'Let this shop trade again?',
    activateBody: 'They will be able to place orders straight away.',
    suspendTitle: 'Stop this shop trading?',
    suspendBody:
      'They will not be able to place orders. Say why — the shop and the audit log both see this.',
    blockCreditTitle: 'Block this shop’s credit?',
    blockCreditBody: 'Orders on account will be refused. Say why.',
    deactivateTitle: 'Make this shop inactive?',
    deactivateBody: 'They stay on the books but cannot order.',
    statusChanged: 'Changed to {{status}}.',
    statusFailed: 'That could not be changed.',
    defaultAddress: 'Default',
  },

  approvals: {
    title: 'Orders to approve',
    subtitle: 'Check stock, credit and licences before anything is set aside.',
    filterLabel: 'Which orders',
    stillWaiting: 'Waiting for a decision',
    allStatuses: 'All',
    loading: 'Loading the queue',
    couldNotLoad: 'The queue could not be loaded.',
    none: 'Nothing to approve',
    noneBody: 'Orders appear here as soon as a shop sends one.',
    order: 'Order',
    submitted: 'Sent',
    estimate: 'Estimate',

    loadingOne: 'Loading this order',
    couldNotLoadOne: 'This order could not be loaded.',
    backToQueue: 'Back to the queue',
    creditLimit: 'Credit limit',
    outstanding: 'Owed now',
    availableCredit: 'Credit left',
    alreadyCommitted: 'Already committed',
    paymentTerms: 'Payment terms',
    days: '{{days}} days',
    cancellationAsked: 'This shop has asked to cancel',
    cancelTheOrder: 'Cancel the order',
    refuseAndCarryOn: 'Refuse and carry on',
    cancelAskTitle: 'Cancel this order?',
    cancelAskBody:
      'The stock it is holding goes back on the shelf and the credit it reserved is released. This cannot be undone — a new order would have to be raised.',
    cancelAskLabel: 'Why is it being cancelled?',
    refuseAskTitle: 'Refuse the cancellation?',
    refuseAskBody:
      'The order carries on as normal and the shop is told why you could not cancel it.',
    refuseAskLabel: 'Why can it not be cancelled?',
    refuseConfirm: 'Refuse the request',
    cancelled: 'Order cancelled. {{credit}} of credit and {{units}} units were released.',
    refused: 'The cancellation was refused and the shop has been told why.',
    decisionFailed: 'That decision could not be recorded.',
    blocked: 'This order is blocked',
    blockedBody: 'Approving it would take {{shop}} to {{projected}} against a limit of {{limit}}.',
    overrideLabel: 'Approve it anyway.',
    overrideBody:
      'Write the reason in the internal notes below — it is required, it is recorded against your name, and it cannot be edited afterwards.',
    adminOnly: 'Administrator decision',
    adminOnlyBody:
      'Only an administrator can approve an order past its credit limit. Ask one to review it, or reduce the quantities until the order fits.',
    requested: 'What the shop asked for',
    columnRequested: 'Asked for',
    columnStock: 'On the shelf',
    columnApproved: 'Approving',
    columnUnitPrice: 'Unit price',
    columnLineDiscount: 'Discount on this line',
    approvedFor: 'How many {{brand}} to approve',
    priceFor: 'Unit price for {{brand}}',
    discountFor: 'Discount on {{brand}}',
    adjustments: 'Your decision',
    orderDiscount: 'Discount on the whole order',
    deliveryCharge: 'Delivery charge',
    internalNotes: 'Internal notes',
    shopNotes: 'Notes the shop will see',
    approvalTotal: 'What this comes to',
    startReview: 'Start reviewing',
    confirmApproval: 'Approve it',
    hold: 'Put it on hold',
    reject: 'Reject it',
    holdTitle: 'Put this order on hold',
    holdBody: 'The shop will see that their order is waiting on something, and what.',
    holdConfirm: 'Put on hold',
    rejectTitle: 'Reject this order',
    rejectBody: 'The shop will be told their order was rejected, and why.',
    rejectConfirm: 'Reject the order',
    started: 'You are now reviewing this order.',
    held: 'On hold, and the shop has been told why.',
    rejected: 'Rejected, and the shop has been told why.',
    approved: 'Approved and sent to the warehouse for picking.',
    actionFailed: 'That could not be done.',
    badAmount: 'Enter an amount like 12.50.',
    previousOrders: 'Earlier orders from this shop',
    noPreviousOrders: 'This is their first order.',
    decisionRecords: '{{count}} decisions recorded',
  },

  reports: {
    overview: 'Overview',
    groupBy: 'Group by',
    day: 'Day',
    week: 'Week',
    month: 'Month',
    preparingCsv: 'Preparing…',
    exportFailed: 'The download could not be prepared.',
    loading: 'Preparing the report',
    couldNotLoad: 'This report could not be prepared.',
    none: 'Nothing to show',
    noneBody: 'There is no data for this period.',

    tabSales: 'Sales',
    tabInventory: 'Stock',
    tabDeliveries: 'Deliveries',
    tabReturns: 'Returns',
    tabAgeing: 'What is owed',

    salesTitle: 'Sales',
    salesSubtitle: 'What was invoiced, what was discounted, and what came back.',
    inventoryTitle: 'Stock',
    inventorySubtitle: 'What it is worth, what is close to expiry, and what is not moving.',
    deliveriesTitle: 'Deliveries',
    deliveriesSubtitle: 'Who got there, who did not, and why.',
    returnsTitle: 'Returns',
    returnsSubtitle: 'How much comes back, why, and what it costs.',
    ageingTitle: 'What is owed',
    ageingSubtitle: 'Customer balances, grouped by how late they are.',

    unitsSold: 'Units sold',
    gross: 'Before discounts',
    discounts: 'Discounts',
    tax: 'Tax',
    netAfterReturns: 'Net after returns',
    trend: 'Over time',
    trendTitle: 'Net sales and credited returns',
    breakdown: 'Breakdown',
    dimensionMedicine: 'Medicine',
    dimensionCategory: 'Category',
    dimensionManufacturer: 'Manufacturer',
    dimensionShop: 'Customer',
    dimensionTerritory: 'Area',
    nothingSold: 'Nothing was sold in this period.',
    name: 'Name',
    units: 'Units',
    net: 'Net',
    returned: 'Returned',
    share: 'Share',

    batches: 'Batches',
    onHand: 'On the shelf',
    availableUnits: 'Free to sell',
    costValue: 'Worth at cost',
    retailValue: 'Worth at selling price',
    blockedBatches: 'Blocked batches',
    expiryExposure: 'How close to expiry',
    expiryChartTitle: 'Stock value by expiry window',
    alreadyExpired: 'Already expired',
    within30: 'Expires within 30 days',
    within90: 'Expires within 90 days',
    beyond90: 'More than 90 days left',
    noStock: 'No stock is on hand.',
    valuationByCategory: 'What each category is worth',
    noStockYet: 'No stock has been received yet.',
    lowStock: 'Running low',
    noLowStock: 'Nothing is running low.',
    lowStockRow: '{{available}} left, reorder at {{threshold}}',
    deadStock: 'Not moving',
    noDeadStock: 'Every batch has sold recently.',
    deadStockRow: 'batch {{batch}}, {{units}} units, {{value}}',
    expiresOn: 'Expires {{date}}',

    deliveries: 'Deliveries',
    delivered: 'Delivered',
    failed: 'Failed',
    successRate: 'Got there',
    onTime: 'On time',
    averageCycle: 'Average time',
    completedAgainstFailed: 'Delivered against failed',
    deliveryChartTitle: 'Deliveries completed and failed by period',
    noDeliveries: 'No deliveries were created in this period.',
    failureReasons: 'Why deliveries failed',
    failureChartTitle: 'Delivery failures by reason',
    noFailures: 'No deliveries failed in this period.',
    byPerson: 'By rider',
    noAssignments: 'No deliveries were assigned in this period.',
    person: 'Rider',
    assigned: 'Given to them',
    collected: 'Money collected',

    returns: 'Returns',
    openReturns: 'Still open',
    credited: 'Credited',
    awaitingCredit: 'Awaiting credit',
    returnRate: 'Return rate',
    restockedOf: '{{restocked}} of {{returned}}',
    unitsRestocked: 'Back on the shelf',
    returnsOverTime: 'Returns over time',
    returnsChartTitle: 'Return requests and credited value',
    requests: 'Requests',
    noReturns: 'No returns were requested in this period.',
    byReason: 'Why things came back',
    reasonChartTitle: 'Returned units by reason',
    byStatus: 'Where they have got to',
    statusChartTitle: 'Returns by status',
    noReturnsShort: 'No returns in this period.',
    mostReturned: 'Most returned medicines',
    noMedicinesReturned: 'No medicines were returned in this period.',

    totalOutstanding: 'Total owed',
    byCustomer: 'By customer',
    nothingOutstanding: 'Nothing is owed.',
    notDue: 'Not due',
    bucket1to30: '1–30',
    bucket31to60: '31–60',
    bucket61to90: '61–90',
    bucket90Plus: '90+',
  },

  analytics: {
    title: 'How the business is doing',
    subtitle: 'Sales, orders, deliveries, returns and what is owed, for the period you choose.',
    detailedReports: 'Detailed reports',
    loading: 'Loading the figures',
    couldNotLoad: 'The figures could not be loaded.',
    none: 'Nothing to show for this period',
    noneBody: 'Try a wider date range.',
    netSales: 'Net sales',
    afterReturns: 'After returns',
    invoices: 'Invoices',
    averageInvoice: 'Average invoice',
    outstanding: 'Owed',
    overdue: 'Overdue',
    salesTrend: 'Sales over time',
    salesChartTitle: 'Net sales and returns by period',
    creditedReturns: 'Credited returns',
    noInvoices: 'No invoices were issued in this period.',
    orderPipeline: 'Orders',
    submitted: 'Sent in',
    approved: 'Approved',
    invoiced: 'Invoiced',
    delivered: 'Delivered',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
    cycleTimes:
      'Sending to review {{submitToReview}} · review to invoice {{reviewToInvoice}} · invoice to delivery {{invoiceToDelivery}}.',
    deliveryPerformance: 'Deliveries',
    deliveries: 'Deliveries',
    completed: 'Completed',
    failed: 'Failed',
    successRate: 'Got there',
    onTime: 'On time',
    averageCycle: 'Average time',
    returnsTitle: 'Returns',
    requests: 'Requests',
    open: 'Still open',
    credited: 'Credited',
    awaitingCredit: 'Awaiting credit',
    returnRate: 'Return rate',
    unitsRestocked: 'Back on the shelf',
    inventoryTitle: 'Stock',
    stockAtCost: 'Stock at cost',
    availableUnits: 'Units free to sell',
    expiringBatches: '{{count}} batches',
    expiringOrExpired: 'Close to expiry or past it',
    lowStock: 'Running low',
    lowStockCount: '{{count}} medicines',
    ageing: 'How old the debt is',
    notYetDue: 'Not yet due',
    days1to30: '1–30 days',
    days31to60: '31–60 days',
    days61to90: '61–90 days',
    over90: 'Over 90 days',
    nothingOutstanding: 'Nothing is owed.',
    topMedicines: 'Best sellers',
    topMedicinesTitle: 'Top medicines by net sales',
    topCustomers: 'Biggest customers',
    topCustomersTitle: 'Top customers by net sales',
    noSales: 'No sales in this period.',
    hours: '{{hours}} h',
    notKnown: '—',
  },

  activity: {
    title: 'What is happening',
    subtitle: 'Orders, picking, deliveries and money, as they happen.',
    refresh: 'Refresh now',
    categoryLabel: 'Which kind',
    all: 'Everything',
    loading: 'Loading activity',
    couldNotLoad: 'The activity feed could not be loaded.',
    none: 'Nothing here yet',
    noneBody: 'Events appear here as people work.',
    /* The per-record timeline embedded in order, delivery and return details. */
    timelineTitle: 'History',
    timelineNone: 'Nothing has happened yet',
    timelineNoneBody: 'Each step somebody takes on this record is listed here.',
    timelineCouldNotLoad: 'This history could not be loaded.',
  },

  /**
   * The charts on the analytics screens. A chart is decoration to anybody who
   * cannot see it, so the same numbers are always rendered as a table beside
   * it — and that table needs a heading in both languages like any other.
   */
  charts: {
    period: 'Period',
    noData: 'No data for this period.',
    nothingToBreakDown: 'Nothing to break down yet.',
    figures: 'The figures behind this chart',
  },

  /**
   * The four credit figures shown above a customer account, on the ledger and
   * on a shop owner's own account screen.
   */
  accountSummary: {
    currentDue: 'Owed now',
    overdue: 'Overdue',
    availableCredit: 'Credit left',
    utilisation: 'Credit used',
    utilisationNote: 'of the limit on this account',
    blocked: 'Credit ordering is blocked',
    blockedWithReason: 'Credit ordering is blocked: {{reason}}',
  },

  finance: {
    ledgerTitle: 'Customer account',
    ledgerSubtitle: 'Every charge, payment, credit and reversal, in the order they happened.',
    shop: 'The shop',
    statement: 'Statement',
    recordPayment: 'Record a payment',
    from: 'From',
    to: 'To',
    applyDates: 'Show this period',
    loadingLedger: 'Loading the account',
    couldNotLoadLedger: 'This account could not be loaded.',
    noEntries: 'Nothing happened in this period',
    noEntriesBody: 'Try a wider date range.',
    posted: 'Posted',
    type: 'What it was',
    description: 'Description',
    debit: 'Charged',
    credit: 'Paid or credited',
    balance: 'Balance',

    paymentsTitle: 'Payments',
    paymentsSubtitle: 'What has been collected, by whom, and what is still to post.',
    ownPaymentsTitle: 'Your payments',
    ownPaymentsSubtitle: 'Everything you have paid us, newest first.',
    loadingPayments: 'Loading payments',
    couldNotLoadPayments: 'Payments could not be loaded.',
    noPayments: 'No payments yet',
    noPaymentsBody: 'Payments appear here as they are collected.',
    noPaymentsFiltered: 'No payments match these filters',
    method: 'How they paid',
    anyMethod: 'Any method',
    anyStatus: 'Any status',
    collectedBy: 'Collected by',
    collectedAt: 'Collected',
    paymentReference: 'Payment',
    invoice: 'Invoice',
    loadingPayment: 'Loading this payment',
    couldNotLoadPayment: 'This payment could not be loaded.',
    allPayments: 'All payments',
    receivedBy: 'Received by',
    postedAt: 'Posted',
    transactionReference: 'Their reference',
    source: 'Where it came from',
    attachment: 'Attached file',
    openAttachment: 'Open the file',
    attachmentFailed: 'That file could not be opened.',
    noAttachment: 'Nothing attached.',
    reverse: 'Reverse this payment',
    reverseTitle: 'Reverse this payment?',
    reverseBody:
      'A reversing entry is posted to the customer’s account. Nothing is deleted — both the payment and the reversal stay on the record.',
    reverseLabel: 'Why is it being reversed?',
    reverseConfirm: 'Reverse it',
    reversed: 'Reversed.',
    reverseFailed: 'That payment could not be reversed.',
    reversalOf: 'This reverses {{reference}}',
    reversedBy: 'Reversed by {{reference}}',
    receipt: 'Receipt',
    receiptPdf: 'Receipt PDF',
    receiptFailed: 'That receipt could not be opened.',
    paymentProof: 'What they sent us',
    controls: 'What you can do',
    delivery: 'Delivery',
    unallocated: 'Not against one invoice',
    postToLedger: 'Post it to the account',
    postToLedgerBody:
      'Posting is permanent. The invoice balance changes straight away and the entry cannot be edited afterwards — only reversed, which leaves both records in place.',
    markFailed: 'The money never arrived',
    markFailedTitle: 'Record that this collection failed',
    markFailedBody: 'The money was not received. Say what happened.',
    markFailedConfirm: 'Record it as failed',
    markedFailed: 'Recorded as failed.',
    readOnly: 'Posted records cannot be changed. Get in touch if something here needs correcting.',
    openReversal: 'Open the reversal {{reference}}',
    openOriginal: 'Open the original {{reference}}',
    created: 'Created',
    manual: 'Entered by hand',
    none: 'None',
    available: 'Available',

    recordTitle: 'Record a payment',
    recordSubtitle: 'What was collected, from whom, and against which invoice.',
    whichShop: 'Which shop',
    selectShop: 'Choose a shop',
    againstInvoice: 'Against which invoice',
    noInvoice: 'Not against a particular invoice',
    amount: 'How much',
    amountHint: 'In taka, for example 1250.00.',
    badAmount: 'Enter an amount like 1250.00.',
    whenCollected: 'When it was collected',
    theirReference: 'Their reference number',
    theirReferenceHint: 'The bKash or bank transaction number, if there is one.',
    attach: 'Attach a receipt',
    saveRecord: 'Record it',
    saving: 'Recording…',
    recorded: 'Payment recorded.',
    recordFailed: 'That payment could not be recorded.',
    loadingForm: 'Loading the form',
    couldNotLoadShops: 'The list of shops could not be loaded.',
    loadingInvoices: 'Loading invoices…',
    proofLabel: 'Photo or PDF of the receipt',
    proofHint: 'JPEG, PNG or PDF, up to 2 MB.',
    proofWrongType: 'The receipt must be a JPEG, PNG or PDF.',
    proofTooLarge: 'The receipt must be smaller than 2 MB.',
    postImmediately: 'Put it on the account straight away',
    allowAdvance: 'Let anything left over sit on the customer’s account as credit',
    amountPositive: 'The amount must be more than zero.',
    savedButNotPosted:
      'The payment was saved but not put on the account. Open it and try posting again.',
    openPending: 'Open the saved payment',
    dueOn: 'due {{amount}}',

    collectionsTitle: 'Payments waiting to post',
    collectionsSubtitle: 'What riders collected today, waiting to be checked and posted.',
    loadingCollections: 'Loading collections',
    couldNotLoadCollections: 'Collections could not be loaded.',
    noCollections: 'Nothing waiting',
    noCollectionsBody: 'Collections appear here as riders record them.',
    postPayment: 'Post it',
    postTitle: 'Post this payment?',
    postBody:
      'The amount goes onto the customer’s account straight away and cannot be edited afterwards.',
    postConfirm: 'Post it',
    postedOk: 'Posted.',
    postFailed: 'That payment could not be posted.',
    rejectCollection: 'Refuse it',
    rejectTitle: 'Refuse this collection?',
    rejectBody: 'Nothing goes onto the customer’s account. Say why, so the rider knows.',
    rejectConfirm: 'Refuse it',
    rejected: 'Refused.',
    rejectFailed: 'That collection could not be refused.',

    reportsOutstanding: 'What is owed',
    reportsOverdue: 'What is overdue',
    reportsCollections: 'What has been collected',
    reportsSubtitle: 'As at the date you choose. Export it for the accountant.',
    asOf: 'As at',
    loadingReport: 'Preparing the report',
    couldNotLoadReport: 'This report could not be prepared.',
    noRows: 'Nothing to report',
    noRowsBody: 'Nothing matched for this period.',
    viewLedger: 'View ledger',
    invoiceCount: 'Invoices',
    oldestDue: 'Oldest due',
    overdueDays: 'Days overdue',
    outstandingTotal: 'Total owed',
    overdueTotal: 'Total overdue',
    collectedTotal: 'Total collected',
    exportCsv: 'Download as CSV',

    couldNotLoadInvoices: 'Your invoices could not be loaded.',
    noInvoices: 'No invoices yet',
    noInvoicesBody: 'An invoice appears here once an order has been packed.',
    issued: 'Issued',
    dueOnDate: 'Due',
    totalAmount: 'Total',
    paidAmount: 'Paid',
    dueAmount: 'Still due',
    overdueBadge: 'Overdue',
    daysOverdue: '{{count}} days overdue',
    noOverdueShops: 'Nothing is overdue',
    noOverdueShopsBody: 'Every shop is within its terms.',
    oldestDueDate: 'Oldest due date',
    outstanding: 'Outstanding',
    overdue: 'Overdue',
    couldNotLoadSummary: 'The due and collection totals could not be loaded.',
    loadingSummary: 'Loading the totals',
    noSummary: 'No totals are available yet',
    noSummaryBody: 'Figures appear once invoices have been issued.',
    totalOutstanding: 'Total outstanding',
    totalOverdue: 'Total overdue',
    pendingCollections: 'Waiting to post',
    collectionsToReview: 'Collections to check',
    overdueShopCount: 'Overdue shops',
    actions: 'What you can do',
    reviewOverdueShops: 'Review overdue shops',
    verifyCollections: 'Check delivery collections',
    ledgerNotice: 'Balances and due dates are worked out by the server, in Dhaka time.',
    collectedToday: 'Collected today',
    pendingHandover: 'Waiting to hand over',
    handoverRecords: '{{count}} records',
    dhakaBusinessDate: 'Today follows the server’s Dhaka business date.',
    couldNotLoadMyCollections: 'Your collection history could not be loaded.',
    noMyCollections: 'Nothing collected yet',
    noMyCollectionsBody: 'Payments you take on a delivery appear here.',
    handoverLabel: 'Handover',
    confirmHandover: 'Confirm handover',
    confirmingHandover: 'Confirming…',
    handoverTitle: 'Confirm this handover?',
    handoverBody: 'You are handing over {{amount}} for {{reference}}.',
    handoverDone: '{{reference}} handed over and confirmed by the server.',
    handoverFailed: 'Handing over needs a connection to the server. Reconnect and try again.',
  },

  delivery: {
    amountMustBePositive: 'Enter how much was collected — it has to be more than nothing.',
    amountAboveDue: 'That is more than this invoice is for.',
    referenceRequired: 'Enter the bank, mobile money or cheque reference.',
    proofRequired: 'Take a photograph of the payment for this way of paying.',
    consentNotice:
      'Ask before you take a photograph, a signature or the location. The location is only read when you tap for it.',
    requiredProof: 'What you need to capture',
    signHere: 'Sign inside this box',
    clearSignature: 'Clear',
    noLocation: 'No location captured yet',
    captureLocation: 'Capture where you are',
    locationDenied: 'Location was not allowed, so it cannot be recorded.',
    cameraDenied: 'The camera was not allowed.',
    cameraNotReady: 'Wait for the camera to be ready.',
    photoFailed: 'The photograph was not taken.',
    takePhoto: 'Take the photograph',
    closeCamera: 'Close the camera',
    deliveryPhoto: 'Photograph of the delivery',
    retakeDeliveryPhoto: 'Take it again',
    openDeliveryCamera: 'Open the camera',
    paymentProof: 'Photograph of the payment',
    retakePaymentProof: 'Take it again',
    capturePaymentProof: 'Photograph the payment',
    paymentSection: 'Money taken',
    sayWhether: 'Say plainly whether you took any money.',
    noPaymentCollected: 'I took no money',
    paymentCollected: 'I took money',
    invoiceDue: 'This invoice is for',
    referenceLabel: 'Bank, mobile money or cheque reference',
    referenceNeeded: 'Bank transfers, mobile money and cheques need a reference and a photograph.',
    completeTitle: 'Finish {{reference}}',
    confirmDelivery: 'Confirm the delivery',
    confirming: 'Confirming…',
    needReceiver: 'Enter who received it and a phone number that starts 01 and has eleven digits.',
    needOtp: 'Enter the six-digit code sent to the shop.',
    needPhoto: 'A photograph of the delivery is needed.',
    needSignature: 'A signature is needed.',
    needLocation: 'The location is needed.',
    badPackageCount: 'Enter how many boxes were handed over — at least one.',
    proofFilesFailed: 'The proof could not be prepared.',
    completionRejected: 'The delivery was not accepted.',
    keepOpenAndRetry:
      'The server has to confirm this. Keep this screen open, reconnect, and tap Confirm again — the same request will be retried, so it cannot post twice.',
    completedWithPayment: 'Delivered. Collection {{reference}} is {{status}}.',
    completedNoPayment: 'Delivered. No money was taken.',
    title: 'Deliveries',
    subtitle: 'Who is taking what, where it has got to, and what came back.',
    refresh: 'Refresh now',
    searchLabel: 'Delivery reference',
    searchHint: 'DEL-2026-000001',
    filterLabel: 'Which deliveries',
    allStatuses: 'All',
    loading: 'Loading deliveries',
    couldNotLoad: 'The deliveries could not be loaded.',
    none: 'Nothing in this queue',
    noneBody: 'Packed orders appear here once they are ready to go out.',
    unassigned: 'Nobody assigned yet',
    datePending: 'No date yet',
    board: 'All deliveries',
    loadingOne: 'Loading this delivery',
    couldNotLoadOne: 'This delivery could not be loaded.',
    forOrder: 'Order {{reference}}',
    assignRider: 'Give this to a rider',
    selectRider: 'Choose a rider',
    assign: 'Assign',
    assigned: 'Assigned.',
    handOver: 'Hand it over',
    handedOver: 'Handed over.',
    markPickedUp: 'Collected from the store',
    markOnTheWay: 'On the way',
    markArrived: 'Arrived at the shop',
    recordDelivery: 'Record the delivery',
    recordFailure: 'Record a failed attempt',
    progressSaved: 'Saved.',
    progressFailed: 'That could not be saved.',
    expectedOn: 'Expected',
    priority: 'Priority',
    attempts: 'Attempts',
    address: 'Where it goes',
    contact: 'Who to call',
    otp: 'Delivery code',
    otpHint: 'The code the shop was sent. It proves the goods reached the right person.',
    receiverName: 'Who received it',
    receiverPhone: 'Their phone number',
    deliveredQuantity: 'How many were accepted',
    failureReason: 'What went wrong',
    notes: 'Notes',
    proof: 'Proof of delivery',
    noProof: 'No proof captured yet.',
    timeline: 'What has happened',
    items: 'What is in the box',
    collectPayment: 'Take payment',
    amountCollected: 'How much was collected',
    paymentMethod: 'How they paid',
    paymentTaken: 'Payment recorded.',
    paymentFailed: 'That payment could not be recorded.',
    offlineNotice: 'Offline — showing the assignments last downloaded.',
    unsynced: '{{count}} actions not yet sent · tap to retry',
    noCached: 'No assignments were downloaded',
    noCachedBody: 'Connect once and your round will be saved for offline use.',
    noneActive: 'No deliveries assigned',
    noneActiveBody: 'Assignments appear here once a package is given to you.',
    packages: '{{count}} packages',
    callShop: 'Call the shop',
    openMap: 'Open the map',
    instruction: 'Please note',
    atTheShop: 'At the shop',
    acknowledge: 'I have the box',
    acknowledged: 'Receipt acknowledged.',
    confirmPickup: 'I have collected it',
    pickedUp: 'Collection recorded.',
    startRoute: 'Start my round',
    routeStarted: 'You are on your way.',
    arrived: 'Arrival recorded.',
    sendOtp: 'Send the delivery code',
    otpSent: 'The code has been sent to the shop.',
    captureProof: 'Take proof and finish',
    savedOffline:
      'Saved on this phone. The delivery is not finished until the server has confirmed it.',
    needsConnection: 'This one needs the server to answer. Reconnect and try again.',
    rejected: 'That was not accepted.',
    expected: 'Expected',
  },

  /**
   * A rider's round for one day.
   *
   * Per-delivery capture was already good — the offline queue, the camera
   * proof, the code — and the day's-work view was missing entirely, so a rider
   * planned their round on paper and the office could not say where anybody
   * was.
   */
  trips: {
    title: 'Delivery rounds',
    subtitle: 'Who is out today, where they are going, and in what order.',
    myTitle: 'My round',
    mySubtitle: 'Your stops for today, in the order to make them.',
    loading: 'Loading rounds',
    couldNotLoad: 'The rounds could not be loaded.',
    none: 'No rounds planned',
    noneBody: 'Plan one to group a rider’s deliveries for the day.',
    plan: 'Plan a round',
    planTitle: 'Plan a round',
    planSubtitle:
      'Pick a rider, a day, and the stops. The order you add them in is the order they will be made in.',
    rider: 'Which rider',
    chooseRider: 'Choose a rider',
    day: 'Which day',
    vehicle: 'Vehicle',
    notes: 'Notes for the rider',
    stops: 'Stops',
    stopsCount: '{{count}} stops',
    packages: 'Boxes',
    remaining: 'Still to do',
    settled: 'Done',
    available: 'Waiting to be delivered',
    availableLoading: 'Loading what is waiting',
    availableFailed: 'What is waiting to be delivered could not be loaded.',
    availableNone: 'Nothing is waiting to go on a round.',
    availableNoneBody: 'Deliveries appear here once a package has been assigned to a rider.',
    /*
     * The list is filtered by the chosen rider, and the old wording did not say
     * so — a screen that shows nothing while another rider has six stops is
     * telling the truth about the query and a lie about the business.
     */
    availableNoneForRider: 'Nothing is waiting for {{rider}}.',
    availableNoneForRiderBody:
      'This shows only deliveries already assigned to the rider you chose. Another rider may have some.',
    ridersFailed: 'The riders could not be loaded, so a round cannot be planned right now.',
    nothingToPlanTitle: 'There is nothing to plan a round with yet',
    nothingToPlanBody:
      'A round groups deliveries that have already been assigned to a rider. Assign one on the Deliveries screen and it will appear here.',
    goToDeliveries: 'Go to Deliveries',
    addStop: 'Add to the round',
    removeStop: 'Take off the round',
    chosen: 'On this round',
    chosenNone: 'No stops yet. Add them from the list on the left.',
    needRider: 'Choose which rider is making this round.',
    needDay: 'Choose which day this round is for.',
    needStops: 'Add at least one stop from the list of deliveries waiting.',
    planned: 'Round {{reference}} planned.',
    planFailed: 'That round could not be planned.',
    savePlan: 'Plan this round',

    sheetLoading: 'Loading this round',
    sheetCouldNotLoad: 'This round could not be loaded.',
    back: 'Back to rounds',
    sequence: 'Order',
    moveUp: 'Move earlier',
    moveDown: 'Move later',
    saveOrder: 'Save this order',
    orderSaved: 'Order saved.',
    orderFailed: 'That order could not be saved.',
    start: 'I have left',
    started: 'You are on your way.',
    startFailed: 'That could not be recorded.',
    cancel: 'Call this round off',
    cancelTitle: 'Call this round off?',
    cancelBody:
      'Nothing happens to the deliveries themselves — they stay assigned and can still be done one at a time. Only the plan is called off.',
    cancelLabel: 'Why is it being called off?',
    cancelConfirm: 'Call it off',
    cancelled: 'Called off. The deliveries are untouched.',
    cancelFailed: 'That round could not be called off.',
    cancelledBecause: 'Called off: {{reason}}',
    openDelivery: 'Open',
    printSheet: 'Print the round sheet',
  },

  deliveryDetail: {
    board: 'All deliveries',
    order: 'The order',
    loading: 'Loading this delivery',
    couldNotLoad: 'This delivery could not be loaded.',
    destination: 'Where it is going',
    package: 'Box',
    packageCount: '{{count}} boxes',
    onePackage: '1 box',
    assignedTo: 'Who is taking it',
    notAssigned: 'Nobody yet',
    requiredProof: 'Proof needed',
    openInvoice: 'Open the invoice',
    pdfFailed: 'That invoice could not be opened.',
    assignTitle: 'Give this to a rider',
    reassignTitle: 'Give this to somebody else',
    person: 'Which rider',
    selectPerson: 'Choose a rider',
    activeCount: '{{count}} on today',
    expectedDate: 'Expected on',
    priority: 'Priority',
    instructions: 'Anything they should know',
    saveAssignment: 'Save this',
    needPersonAndDate: 'Choose a rider and a date.',
    assignmentSaved: 'Saved.',
    cancelDelivery: 'Call this off',
    cancelTitle: 'Call this delivery off?',
    cancelBody:
      'The delivery is called off and the order goes back to needing a rider. Use this only while the box is still at the store.',
    cancelled: 'Called off.',
    handoverTitle: 'Hand it to the rider',
    handoverBody:
      'Check the box reference, the invoice, the count and who is taking it, then confirm.',
    confirmHandover: 'Confirm the handover',
    handoverAsk: 'Hand {{package}} over?',
    handoverAskBody:
      'The box becomes the rider’s responsibility. Confirm only once they are physically holding it.',
    handoverDone: 'Handed over.',
    returnedTitle: 'A box has come back',
    returnedBody: 'Check the box before confirming it is back in the store’s hands.',
    returnedAsk: 'Is the box back at the store?',
    returnedAskBody:
      'Confirm only once you are holding it. The store takes custody again and the stock becomes available.',
    returnedConfirm: 'Yes, it is back',
    confirmReturned: 'Confirm it is back',
    returnConfirmed: 'Confirmed.',
    failedAttempt: 'A delivery that did not work',
    startReturn: 'Send it back to the store',
    returnStarted: 'On its way back.',
    proof: 'Proof of delivery',
    receiver: 'Who received it',
    packages: 'Boxes',
    time: 'When',
    otp: 'Code',
    otpVerified: 'Checked',
    otpNotRequired: 'Not needed',
    gps: 'Location',
    notProvided: 'Not given',
    viewSignature: 'See the signature',
    viewPhoto: 'See the photo',
    proofFailed: 'That file could not be opened.',
    timeline: 'What has happened',
    activity: 'Delivery activity',
    actionFailed: 'That could not be done.',
  },

  /** Why a delivery did not happen. */
  deliveryFailureReason: {
    [DeliveryFailureReason.SHOP_CLOSED]: 'The shop was closed',
    [DeliveryFailureReason.CUSTOMER_UNAVAILABLE]: 'Nobody was there',
    [DeliveryFailureReason.ADDRESS_NOT_FOUND]: 'Could not find the address',
    [DeliveryFailureReason.CUSTOMER_REJECTED]: 'The customer refused it',
    [DeliveryFailureReason.PAYMENT_UNAVAILABLE]: 'They could not pay',
    [DeliveryFailureReason.PACKAGE_ISSUE]: 'Something wrong with the box',
    [DeliveryFailureReason.VEHICLE_ISSUE]: 'A problem with the vehicle',
    [DeliveryFailureReason.OTHER]: 'Something else',
  } as Record<DeliveryFailureReason, string>,

  /** What a rider has to capture. `Record<DeliveryProofType, string>`. */
  deliveryProofType: {
    [DeliveryProofType.OTP]: 'The code sent to the shop',
    [DeliveryProofType.SIGNATURE]: 'A signature',
    [DeliveryProofType.PHOTOGRAPH]: 'A photograph',
    [DeliveryProofType.GPS]: 'Where you are',
  } as Record<DeliveryProofType, string>,

  deliveryPriority: {
    [DeliveryPriority.NORMAL]: 'Normal',
    [DeliveryPriority.HIGH]: 'Soon',
    [DeliveryPriority.URGENT]: 'Urgent',
  } as Record<DeliveryPriority, string>,

  picking: {
    scan: 'Scan or type a batch number',
    scanHint: 'One scan is one carton. Add “x 12” to record a whole outer at once.',
    scanPlaceholder: 'Scan here…',
    scanNotFound: 'Nothing on this order matches {{code}}.',
    scanAmbiguous: '{{code}} matches more than one line. Scan the batch number instead.',
    scanCapped: 'That is already the whole allocation of {{brand}}.',
    countingProgress: 'Counting from scans: {{counted}} of {{allocated}} units.',
    notCounting:
      'Every line is set to its full allocation. Your first scan starts counting from zero.',
    stopCounting: 'Stop counting and refill the sheet',
    loading: 'Loading this picking list',
    couldNotLoad: 'This picking list could not be loaded.',
    queue: 'Back to the queue',
    allocated: 'What to pick',
    packingConfirmation: 'Confirm what is going in the box',
    columnAllocated: 'To pick',
    columnPicked: 'Picked',
    columnPacked: 'Packed',
    columnShortfall: 'Why fewer',
    pickedFor: 'How many {{brand}} were picked',
    packedFor: 'How many {{brand}} are going in the box',
    shortfallFor: 'Why fewer {{brand}} than were picked',
    startPicking: 'Start picking',
    saveProgress: 'Save where I am',
    pause: 'Pause',
    completePicking: 'Finished picking',
    resumePicking: 'Carry on picking',
    started: 'Picking started. Confirm each batch and quantity as you go.',
    saved: 'Saved.',
    paused: 'Paused.',
    completed: 'Picking finished. This has moved to packing.',
    resumed: 'Carrying on.',
    startFailed: 'Picking could not be started.',
    updateFailed: 'That could not be saved.',
    packageCount: 'How many boxes',
    weight: 'Weight in grams',
    weightHint: 'Optional.',
    packingNotes: 'Packing notes',
    confirmPacking: 'Confirm packing and issue the invoice',
    packed: 'Packed. The invoice has been issued and cannot be changed.',
    packFailed: 'Packing could not be completed.',
    discrepancies: 'Things that did not add up',
    resolveAndReturn: 'Settle it and carry on picking',
    scanWithCamera: 'Scan it with the camera',
    confirmCodeManually: 'Type the code instead',
    barcodeHint: 'The number on the box, or the batch number printed on it.',
    codeConfirmed: 'Code matched.',
    codeNoMatch: 'That code is not on this list. Check you have the right box.',
    cameraDenied: 'The camera was not allowed. Type the code instead.',
    closeScanner: 'Close the camera',
    confirmedByScan: 'Confirmed by scan',
    notYetConfirmed: 'Not confirmed yet',
    reportOnLine: 'Report a problem with {{brand}}',
    reportTitle: 'Report a problem',
    reportLine: 'Which line has the problem',
    reportType: 'What is wrong',
    affectedQuantity: 'How many affected',
    report: 'Tell management',
    needNotes: 'Describe the problem in at least three characters.',
    reported: 'Reported to management.',
    reportFailed: 'That could not be reported.',
    resolveTitle: 'Settle this problem',
    resolveBody: 'Say what was actually found and what was done about it.',
    resolveLabel: 'What happened?',
    resolveConfirm: 'Settle it',
    resolved: 'Settled. This has gone back to picking.',
    resolveFailed: 'That could not be settled.',
    invoiceSubtotal: 'Subtotal',
    invoiceDiscount: 'Discount',
    invoiceDelivery: 'Delivery',
    invoiceTax: 'Tax',
    invoiceGrandTotal: 'Total for this invoice',
    invoicePreviousBalance: 'Owed before this',
    invoiceOutstanding: 'Owed in total',
    signature: 'Authorised signature',
    a4Pdf: 'A4 PDF',
    thermalPdf: 'Till-roll PDF',
    printA4: 'Print A4',
    printThermal: 'Print till roll',
    pdfFailed: 'That invoice could not be opened.',
    packageLabel: 'Box label',
    boxes: '{{count}} boxes',
    oneBox: '1 box',
    grams: '{{grams}} g',
  },

  /** What can go wrong on a pick. Local to fulfilment; there is no shared enum. */
  discrepancyType: {
    MISSING_QUANTITY: 'Not enough on the shelf',
    DAMAGED_ITEM: 'Damaged',
    WRONG_BATCH: 'Wrong batch',
    EXPIRED_BATCH: 'Batch has expired',
    STOCK_MISMATCH: 'The count does not match',
    PRODUCT_UNAVAILABLE: 'Cannot find it at all',
    OTHER: 'Something else',
  } as Record<string, string>,

  /** The status of a picking list. Server-supplied strings, not a shared enum. */
  pickingStatus: {
    ALL: 'All',
    OUTSTANDING: 'Still to pick',
    PENDING: 'Approved and waiting',
    PICKING: 'Being picked',
    PAUSED: 'Paused',
    PACKING: 'Being packed',
    BLOCKED_DISCREPANCY: 'Something does not add up',
    PACKED: 'Packed',
  } as Record<string, string>,

  medicineForm: {
    productType: 'Type of product',
    title: 'Add a medicine',
    subtitle: 'Prices are entered in taka. Everything else describes the pack itself.',
    sku: 'Stock code',
    barcode: 'Barcode',
    brandName: 'Brand name',
    genericName: 'Generic name',
    manufacturer: 'Manufacturer',
    strength: 'Strength',
    dosageForm: 'Form',
    packSize: 'Pack size',
    unit: 'Sold as',
    category: 'Category',
    costPrice: 'What we pay',
    sellingPrice: 'What the shop pays',
    mrp: 'MRP (printed on the pack)',
    minimumOrderQuantity: 'Smallest order',
    maximumOrderQuantity: 'Largest order',
    classification: 'Classification',
    coldChain: 'Must be kept cold',
    description: 'Description',
    productImageUrl: 'Product photograph',
    save: 'Save this medicine',
    saving: 'Saving…',
    saveFailed: 'This medicine could not be saved.',
    badAmount: 'Enter an amount like 12.50.',
    editTitle: 'Edit this medicine',
    editSubtitle:
      'Changing these changes what every future order sees. Past orders keep what they were charged.',
    saveChanges: 'Save changes',
    loading: 'Loading this medicine…',
    couldNotLoad: 'This medicine could not be loaded, so there is nothing to edit yet.',
    saved: '{{name}} has been saved.',
  },

  /**
   * An example of the value, shown inside the empty box.
   *
   * A placeholder is never load-bearing — it disappears the moment somebody
   * types, and a screen reader may not announce it at all. So it carries only
   * the *shape* of a good answer, for the fields where the shape is not
   * obvious: a code, an amount, a way of describing a pack. Anything a person
   * must know before typing is a hint, and anything about how the field works
   * is a `HelpTip`.
   */
  medicinePlaceholder: {
    sku: 'NAP-500-10T',
    barcode: '8901234567890',
    brandName: 'Napa',
    genericName: 'Paracetamol',
    manufacturer: 'Beximco Pharmaceuticals',
    strength: '500 mg',
    dosageForm: 'Tablet',
    packSize: '10 x 10 tablets',
    unit: 'Box',
    category: 'Painkillers',
    costPrice: '82.50',
    sellingPrice: '95.00',
    mrp: '120.00',
    minimumOrderQuantity: '1',
    maximumOrderQuantity: '100',
    description: 'Anything a shop should read before ordering.',
    productImageUrl: 'https://…/napa-500.webp',
  },

  /**
   * The always-visible rule, for the four fields where getting it wrong is
   * either an outright refusal or expensive.
   *
   * Deliberately short and deliberately few. A hint on every field is a form
   * nobody reads; these are the ones where the answer cannot be guessed from
   * the label.
   */
  medicineHint: {
    barcode: 'Optional. The number under the bars on the pack.',
    unit: 'What one of the number in an order means.',
    costPrice: 'In taka.',
    sellingPrice: 'In taka. Cannot be above the MRP.',
    mrp: 'Optional. In taka.',
    maximumOrderQuantity: 'Optional.',
    productImageUrl: 'A web address, or a file we already hold.',
  },

  /**
   * How each field works, and what it changes elsewhere.
   *
   * This is the layer that was missing entirely: the form said "Sold as" and
   * nothing anywhere explained that putting *Tablet* there means a shop
   * ordering five gets five tablets rather than five boxes. Written as
   * sentences a storekeeper would say, per the plain-language rule at the top
   * of this file — no "FEFO", no "basis points", no "idempotency".
   */
  medicineHelp: {
    about: 'About {{field}}',
    sku: 'Your own code for this product. It must be different from every other one, and it is what a stock count or an import matches on. Changing it does not change past orders.',
    barcode:
      'Scanning this in the warehouse finds this product. Leave it blank if the pack has none.',
    brandName: 'The name printed largest on the pack. This is what people search for.',
    genericName:
      'The active ingredient. Required for anything sold on prescription, so a pharmacist can check what they are dispensing.',
    manufacturer: 'Who made it. Used to trace a batch back after a recall.',
    strength:
      'How much active ingredient is in one unit. The same brand at two strengths is two products here.',
    dosageForm: 'The form it takes — tablet, syrup, injection, cream.',
    packSize:
      'What is inside one pack you sell. Write it the way the shop reads it off the carton.',
    unit: 'An order for 5 means 5 of this. If you sell by the box, put Box — not Tablet — or a shop ordering 5 gets 5 tablets.',
    category: 'Groups this with similar products so it can be filtered and reported on.',
    costPrice: 'What this costs you. Only managers see it; it never appears to a shop.',
    sellingPrice:
      'The ordinary trade price. Every order uses this unless the customer has a price list or their own discount, which both take priority.',
    mrp: 'The price printed on the pack. A pharmacy may not sell above it, so this is what the shop’s own profit is measured against. Leave it blank if the pack shows none.',
    minimumOrderQuantity:
      'The smallest number a shop may order at once. Set 1 if there is no minimum.',
    maximumOrderQuantity:
      'A cap per order — useful for something scarce. Leave it blank for no cap.',
    productType:
      'Which shelf this sits on. It changes nothing about pricing or stock; it is for browsing and reporting.',
    classification:
      'Whether this is dispensed against a prescription. Choosing Prescription makes generic name, strength and form required, because a pharmacist cannot dispense without them.',
    coldChain:
      'Ticked means it must stay refrigerated. It is recorded on the product and shown to whoever handles the box; it does not yet change how the system picks or packs.',
    description: 'Shown to shops on the product page. Not for internal notes.',
    productImageUrl:
      'The picture shops see in the catalogue. Leave it blank and a placeholder is shown.',
  },

  /**
   * Buying in: suppliers, purchase orders, goods receipt, the batch trace and
   * the prescription register.
   *
   * Every endpoint behind these has existed and been tested since phase 6 and
   * appeared in none of the 51 navigation items, so for four phases the only
   * way to reach any of it was curl.
   */
  purchasing: {
    suppliersTitle: 'Suppliers',
    allStatuses: 'All',
    suppliersSubtitle: 'Who you buy from, and the licences that let them sell to you.',
    suppliersLoading: 'Loading suppliers',
    suppliersCouldNotLoad: 'The suppliers could not be loaded.',
    suppliersNone: 'No suppliers yet',
    suppliersNoneBody: 'Add the companies you buy from. A purchase order needs one.',
    addSupplier: 'Add a supplier',
    showInactive: 'Include ones you no longer buy from',
    supplierName: 'Company name',
    contactName: 'Who to ask for',
    paymentTerms: 'Days to pay',
    licence: 'Drug licence',
    licenceExpiry: 'Licence expires',
    licenceExpired: 'Expired',
    licenceSoon: 'expires soon',
    noLicenceRecorded: 'None recorded',
    active: 'Buying from them',
    inactive: 'Not buying from them',
    supplierSaved: '{{name}} added.',
    supplierFailed: 'That supplier could not be added.',
    newSupplierTitle: 'Add a supplier',
    newSupplierSubtitle:
      'The licence number and its expiry are what an inspection asks for, so record them if you have them.',
    saveSupplier: 'Add this supplier',

    ordersTitle: 'Purchase orders',
    ordersSubtitle: 'What you have ordered in, and how much of it has arrived.',
    ordersLoading: 'Loading purchase orders',
    ordersCouldNotLoad: 'The purchase orders could not be loaded.',
    ordersNone: 'No purchase orders yet',
    ordersNoneBody: 'Raise one to order stock from a supplier.',
    raiseOrder: 'Raise a purchase order',
    supplier: 'Supplier',
    expectedDate: 'Expected',
    supplierReference: 'Their reference',
    supplierReferenceHint:
      'The number on their paperwork, so a paper invoice can be matched to this.',
    lines: '{{count}} lines',
    ordered: 'Ordered',
    received: 'Arrived',
    outstanding: 'Still to come',
    unitCost: 'Cost each',
    lineTotal: 'Line total',
    orderTotal: 'Order total',
    orderLoading: 'Loading this purchase order',
    orderCouldNotLoad: 'This purchase order could not be loaded.',
    backToOrders: 'Back to purchase orders',
    orderLines: 'What was ordered',
    receipts: 'What has arrived',
    noReceipts: 'Nothing has arrived against this order yet.',
    receiptOn: 'Received {{when}}',
    receiveTitle: 'Book in what arrived',
    receiveBody:
      'Count the cartons on the bay and enter what is actually there. What you enter becomes sellable stock, so it has to match the shelf.',
    receiveLine: 'Booking in {{brand}}',
    batchNumber: 'Batch number on the carton',
    manufacturingDate: 'Made on',
    expiryDate: 'Expires on',
    receivedQuantity: 'How many arrived',
    warehouseLocation: 'Where you are putting it',
    supplierBatchReference: 'Their batch reference',
    varianceReason: 'Why fewer than ordered',
    varianceReasonHint:
      'Required when less arrives than was ordered. It is what you take back to the supplier.',
    supplierInvoiceReference: 'Their delivery note or invoice number',
    confirmReceipt: 'Book this in',
    receiptSaved: 'Booked in. The stock is now sellable.',
    receiptFailed: 'That could not be booked in.',
    nothingToReceive: 'Every line on this order has arrived in full.',
    addLine: 'Add another medicine',
    removeLine: 'Remove this line',
    chooseMedicine: 'Which medicine',
    quantity: 'How many',
    needSupplier: 'Choose which supplier this order goes to.',
    needLine: 'Add at least one medicine with a quantity.',
    orderRaised: 'Purchase order {{reference}} raised.',
    orderFailed: 'That purchase order could not be raised.',
    newOrderTitle: 'Raise a purchase order',
    newOrderSubtitle: 'What you are ordering, from whom, and what you expect to pay for it.',
    saveOrder: 'Raise this order',
    badAmount: 'Enter an amount like 12.50.',

    recallTitle: 'Trace a batch',
    recallSubtitle:
      'Given a batch: who has it, and where it came from. Looking changes nothing, so check freely.',
    recallSearchLabel: 'Batch number printed on the carton',
    recallSearchHint: 'The number on the supplier notice, not an internal identifier.',
    recallSearch: 'Find it',
    recallNoMatch: 'No batch carries that number',
    recallNoMatchBody:
      'Check the number against the carton. The same number can also belong to more than one medicine.',
    recallCandidates: 'Batches with that number',
    recallStartHere: 'Enter a batch number to begin',
    recallStartBody:
      'Nothing is recalled by looking. This only answers who received it and where it came from.',
    recallTracing: 'Tracing this batch',
    recallCouldNotTrace: 'That batch could not be traced.',
    recallChoose: 'Trace this one',
    onHand: 'Still on the shelf',
    forwardTitle: 'Who received it',
    forwardBody: 'Every shop this batch reached, with the number to ring.',
    forwardNone: 'None of this batch has left the warehouse.',
    backwardTitle: 'Where it came from',
    predatesPurchasing:
      'This batch was booked in before purchase orders were recorded, so there is no supplier against it. That is a different answer from "we do not know", and it is the one to give an inspector.',
    despatched: 'Sent out',
    stillHeld: 'Still held',
    unaccounted: 'Cannot be accounted for',
    unaccountedBody:
      'Received, less what went out, less what is on the shelf. Anything other than zero is damaged, expired, written off or returned stock, and it is a question to answer before a recall is closed.',
    shopsAffected: 'Shops affected',
    quantitySent: 'How many',
    invoicedOn: 'Invoiced',
    deliveredOn: 'Delivered',
    receivedBy: 'Signed for by',
    blocked: 'Blocked',
    quarantined: 'Held back',

    registerTitle: 'Prescription register',
    registerSubtitle:
      'What came in and what went out for every prescription medicine, and whether the arithmetic matches the shelf.',
    registerLoading: 'Building the register',
    registerCouldNotLoad: 'The register could not be built.',
    registerNone: 'No prescription medicines are recorded',
    registerNoneBody: 'A medicine has to be marked as prescription-only to appear here.',
    from: 'From',
    to: 'To',
    apply: 'Show this period',
    opening: 'At the start',
    closing: 'At the end',
    variance: 'Difference',
    varianceHint:
      'What the movements say, against what the shelf says. Anything other than zero is a question somebody has to answer.',
    writtenOff: 'Written off',
    returned: 'Returned',
    byShopTitle: 'Which shops bought them',
    byShopNone: 'No prescription medicines were sold in this period.',
    invoices: 'On invoices',
    badRange: 'Give a start date before the end date.',
  },

  inventory: {
    title: 'Stock',
    subtitle: 'What is on the shelf, what it is doing, and every movement that got it there.',
    loading: 'Loading stock',
    couldNotLoad: 'Stock could not be loaded.',
    onHand: 'On the shelf',
    available: 'Free to sell',
    reserved: 'Set aside',
    damaged: 'Damaged',
    filterLabel: 'Which batches',
    allBatches: 'All batches',
    lowStock: 'Running low',
    nearExpiry: 'Close to expiry',
    expired: 'Past expiry',
    batchStock: 'Batches on hand',
    noBatches: 'No batches match this view.',
    columnBatch: 'Medicine and batch',
    columnPicking: 'Being picked',
    columnPacked: 'Packed',
    columnWarnings: 'Warnings',
    columnActions: 'Record a change',
    blocked: 'Blocked',
    quarantined: 'Held back',
    actionFor: 'Record a change to batch {{batch}}',
    chooseAction: 'Choose…',
    recordTitle: 'Record {{action}}',
    recordBody: 'Batch {{batch}}. This changes what the system believes is on the shelf.',
    howMany: 'How many units?',
    badQuantity: 'Enter a whole number of units, greater than zero.',
    whyTitle: 'Why is this stock being changed?',
    whyBody: 'Stock movements are permanent records. This is what explains the change later.',
    recordIt: 'Record it',
    recorded: '{{action}} recorded.',
    actionFailed: 'That change could not be recorded.',
    receiveStock: 'Book in stock',
    medicine: 'Which medicine',
    selectMedicine: 'Choose a medicine',
    batchNumber: 'Batch number',
    manufacturingDate: 'Made on',
    expiryDate: 'Expires on',
    costPrice: 'What we paid',
    sellingOverride: 'Selling price for this batch',
    sellingOverrideHint: 'Leave this empty to use the medicine’s usual price.',
    quantity: 'How many arrived',
    warehouseLocation: 'Where it is stored',
    received: 'Stock booked in.',
    receiveFailed: 'That stock could not be booked in.',
    badAmount: 'Enter an amount like 12.50.',
    movements: 'Recent movements',
    noMovements: 'No movements recorded yet.',
  },

  /**
   * `Record<StockMovementType, string>` — a new movement type fails the build
   * here rather than reaching a storekeeper as `PACKING_REVERSAL`.
   */
  /**
   * Physical stock counts.
   *
   * The screen is built around one rule: **the counter never sees the expected
   * figure.** The server withholds it while the sheet is open, so this is a
   * property of the system rather than of the layout.
   */
  stocktake: {
    title: 'Stock counts',
    subtitle: 'What was actually on the shelf, who counted it, and what was agreed.',
    loading: 'Loading stock counts',
    couldNotLoad: 'The stock counts could not be loaded.',
    none: 'No counts yet',
    noneBody: 'Open one to count an aisle or a set of medicines.',
    open: 'Start a count',
    openTitle: 'Start a stock count',
    openSubtitle:
      'Everything in scope goes on the sheet at the figures the system holds now. Those figures are hidden until counting is finished.',
    location: 'Which part of the warehouse',
    locationHint: 'Leave this empty to count everything.',
    notes: 'Notes',
    opened: 'Count {{reference}} is open.',
    openFailed: 'That count could not be opened.',
    openedOn: 'Opened',
    postedOn: 'Posted',
    progress: 'Counted',
    ofLines: '{{counted}} of {{total}}',
    uncounted: 'Not counted',
    differing: 'Differ',
    short: 'Short',
    over: 'Over',

    sheetLoading: 'Loading this count',
    sheetCouldNotLoad: 'This count could not be loaded.',
    back: 'Back to stock counts',
    blindNotice:
      'You cannot see what the system expects. Count what is on the shelf and enter that. The difference appears once you finish.',
    countedQuantity: 'How many are there',
    countedFor: 'How many {{brand}} are on the shelf',
    reasonFor: 'Why {{brand}} differs',
    saveCounts: 'Save what I have counted',
    saved: 'Saved.',
    saveFailed: 'That could not be saved.',
    nothingEntered: 'Enter at least one count first.',
    finishCounting: 'Finished counting',
    submitted: 'Sent for review. The differences are now visible.',
    submitFailed: 'That could not be sent for review.',

    reviewTitle: 'What the count found',
    reviewBody:
      'Every line that differs needs an explanation before it can be posted. Uncounted lines post nothing.',
    expected: 'System says',
    counted: 'Counted',
    difference: 'Difference',
    reason: 'Explanation',
    notCounted: 'Nobody counted this',
    postCount: 'Approve and post',
    postTitle: 'Post this count?',
    postBody:
      'Every difference becomes a stock adjustment, in one go. It cannot be undone — a further correction would be a new count or a batch adjustment.',
    postConfirm: 'Post the count',
    posted: 'Posted. The shelf figures now match the count.',
    postFailed: 'That count could not be posted.',
    needReasons: 'Explain every line that differs before posting.',
    abandon: 'Abandon this count',
    abandonTitle: 'Abandon this count?',
    abandonBody: 'Nothing is posted and the sheet is kept, marked as abandoned, with your reason.',
    abandonLabel: 'Why is it being abandoned?',
    abandonConfirm: 'Abandon it',
    abandoned: 'Abandoned. Nothing was posted.',
    abandonFailed: 'That count could not be abandoned.',
    abandonedBecause: 'Abandoned: {{reason}}',
    cannotPostYet: 'This count is still being counted.',
  },

  warehouses: {
    title: 'Warehouses',
    subtitle:
      'Where stock is held. Anything that does not name one belongs to the default, so a single godown needs nothing configured.',
    loading: 'Loading warehouses',
    couldNotLoad: 'The warehouses could not be loaded.',
    none: 'No warehouses yet',
    noneBody: 'Add one and everything already on the shelf belongs to it.',
    add: 'Add a warehouse',
    addTitle: 'Add a warehouse',
    addSubtitle:
      'The first one becomes the default and holds everything already on hand. Making a later one the default moves it rather than adding a second.',
    code: 'Short code',
    codeHint: 'What staff say out loud: DHK, CTG.',
    name: 'Name',
    city: 'City',
    district: 'District',
    contactPhone: 'Phone',
    makeDefault: 'Make this the default',
    makeDefaultHint: 'Stock that names no warehouse belongs to whichever one is the default.',
    isDefault: 'Default',
    batches: 'Batches',
    onHand: 'On the shelf',
    available: 'Free to sell',
    save: 'Add this warehouse',
    saved: '{{name}} added.',
    saveFailed: 'That warehouse could not be added.',
  },

  /**
   * Price lists and free-goods offers.
   *
   * The commercial vocabulary of this trade: what a group of customers pays,
   * and what they get free for buying in quantity. Both existed as models and a
   * resolver with no way in.
   */
  /**
   * Taking an order for a customer who is on the phone.
   *
   * Written for somebody typing while somebody else talks: short labels, and
   * hints that say what the keyboard does rather than what the field means.
   */
  orderEntry: {
    title: 'Take an order',
    subtitle:
      'For a customer on the phone or in front of you. Type a name, press Enter, type the quantity, press Enter again.',
    customer: 'Customer',
    chooseCustomer: 'Choose a customer',
    deliverTo: 'Deliver to',
    chooseAddress: 'Choose an address',
    payment: 'Payment',
    addLine: 'Add a medicine',
    addLineHint:
      'Search by brand, generic name, code or barcode. Arrow keys to choose, Enter to add.',
    searchPlaceholder: 'Start typing a name\u2026',
    quantityForPending: 'How many {{brand}}?',
    quantityFor: 'Quantity of {{brand}}',
    addToOrder: 'Add',
    alreadyOnOrder: '{{brand}} is already on this order. Change the quantity instead.',
    plusFree: '+ {{free}} free',
    unitPrice: 'Unit price',
    available: 'In stock',
    lineTotal: 'Line total',
    subtotal: 'Subtotal',
    discount: 'Discount',
    delivery: 'Delivery',
    total: 'Total',
    nothingYet: 'Nothing on this order yet',
    nothingYetBody: 'Search above and press Enter to add the first line.',
    place: 'Place this order',
    placed: 'Order {{reference}} placed.',
    couldNotPlace: 'That order could not be placed.',
    couldNotPrice: 'The prices could not be worked out.',

    /*
     * The same screen, on the phone a rep actually carries.
     *
     * Most of the wording above is reused verbatim — a subtotal is a subtotal.
     * What could not be reused is every sentence that mentions Enter or the
     * arrow keys: true of a telesales operator at a keyboard, and false of
     * somebody standing at a shop counter holding a handset. Reusing those
     * would have been a catalogue that lies rather than a catalogue that is
     * short.
     */
    pickCustomer: 'Who is this order for?',
    pickCustomerBody: 'Your customers — the shops in the territory you cover.',
    searchCustomerPlaceholder: 'Shop name, phone or code…',
    couldNotLoadCustomers: 'Your customers could not be loaded.',
    noCustomers: 'No customers in your territory',
    noCustomersBody:
      'Ask the office to put the shops you cover into your territory, then pull down to refresh.',
    orderingFor: 'Ordering for',
    change: 'Change customer',
    tapToAdd: 'Search by brand, generic name or code. Tap a result to add it.',
    typeMore: 'Type at least two letters.',
    noMatches: 'Nothing matches that',
    noMatchesBody: 'Try part of the brand name or the generic name.',
    onThisOrder: 'On this order',
    nothingYetOnPhone: 'Search above and tap a medicine to add the first line.',
    increase: 'One more {{brand}}',
    decrease: 'One fewer {{brand}}',
    adjustedTo: '{{brand}} set to {{quantity}}, which is what the catalogue allows.',
    removed: '{{brand}} taken off this order.',
    refreshing: 'Updating the total',
    blockedNoCustomer: 'Choose a customer first.',
    blockedNoLines: 'Add a medicine first.',
    blockedNoAddress: 'Choose where this order is going.',
    noAddressOnFile:
      'This customer has no delivery address recorded, so an order cannot be placed for them yet. The office can add one.',
    blockedNoPrice: 'Waiting for the total.',
    blockedOffline:
      'No connection. An order needs a live price and a live credit check, so it cannot be taken now and sent later.',
    notSaved: 'That order was not saved anywhere. Try again once you have a connection.',
  },

  priceLists: {
    title: 'Price lists',
    subtitle:
      'What each group of customers pays. A customer with no list assigned is charged from the default one, and then from the medicine\u2019s own price.',
    loading: 'Loading price lists',
    couldNotLoad: 'The price lists could not be loaded.',
    none: 'No price lists yet',
    noneBody:
      'Add one and assign customers to it. Until then everybody pays the medicine\u2019s own price.',
    add: 'Add a price list',
    addTitle: 'Add a price list',
    editTitle: 'Edit this price list',
    formSubtitle:
      'The whole sheet is saved at once. If somebody else has changed it since you opened it, you will be told rather than overwriting their prices.',
    name: 'Name',
    default: 'Default',
    isDefault: 'Make this the default',
    isDefaultHint: 'Customers with no list of their own are charged from this one.',
    pricedItems: 'Priced items',
    customers: 'Customers',
    inForce: 'In force',
    openEnded: 'No end date',
    openEndedHint: 'Leave both blank to run until somebody ends it.',
    validFrom: 'From',
    validTo: 'Until',
    lines: 'Prices',
    medicine: 'Medicine',
    chooseMedicine: 'Choose a medicine',
    unitPrice: 'Unit price',
    discountPercent: 'Discount %',
    addLine: 'Add a price',
    removeLine: 'Remove',
    pricedCount: '{{count}} priced, from {{cheapest}}.',
    save: 'Save this price list',
    saved: '{{name}} saved.',
    saveFailed: 'That price list could not be saved.',
  },

  schemes: {
    title: 'Free-goods offers',
    subtitle:
      'Buy ten, get one. The customer is charged for what they ordered and the free units go out alongside \u2014 the warehouse picks eleven and the invoice prices ten.',
    loading: 'Loading offers',
    couldNotLoad: 'The offers could not be loaded.',
    none: 'No offers yet',
    noneBody: 'Add one and it applies to every order placed after it.',
    add: 'Add an offer',
    addTitle: 'Add a free-goods offer',
    editTitle: 'Edit this offer',
    formSubtitle:
      'Changing an offer never restates an order already placed \u2014 each order records the terms it was given.',
    name: 'Name',
    medicine: 'Medicine',
    chooseMedicine: 'Type a brand or a stock code',
    medicineHint: 'Start typing and pick from the list. The search runs over the whole catalogue.',
    chosenMedicine: 'Chosen: {{name}}',
    terms: 'Offer',
    buyGet: 'Buy {{buy}}, get {{free}} free',
    buyQuantity: 'Buy',
    buyQuantityHint: 'Whole multiples only. Nine units under a 10+1 earns nothing.',
    freeQuantity: 'Free',
    audience: 'Who gets it',
    audienceHint: 'Name nobody and it runs for every customer, which is the usual case.',
    everyCustomer: 'Every customer',
    namedCustomers: '{{count}} named customers',
    inForce: 'In force',
    openEnded: 'No end date',
    openEndedHint: 'Leave both blank to run until somebody ends it.',
    validFrom: 'From',
    validTo: 'Until',
    save: 'Save this offer',
    saved: '{{name}} saved.',
    saveFailed: 'That offer could not be saved.',
  },

  movementType: {
    [StockMovementType.RECEIPT]: 'Booked in',
    [StockMovementType.ADDITION]: 'Added',
    [StockMovementType.ADJUSTMENT]: 'Count corrected',
    [StockMovementType.DAMAGE]: 'Damage',
    [StockMovementType.EXPIRY]: 'Expiry',
    [StockMovementType.QUARANTINE]: 'Held back',
    [StockMovementType.QUARANTINE_RELEASE]: 'Released from hold',
    [StockMovementType.RESERVATION]: 'Set aside',
    [StockMovementType.RESERVATION_RELEASE]: 'No longer set aside',
    [StockMovementType.PICKING]: 'Moved to picking',
    [StockMovementType.PICKING_RETURN]: 'Back from picking',
    [StockMovementType.PACKING]: 'Packed',
    [StockMovementType.PACKING_REVERSAL]: 'Unpacked',
    [StockMovementType.RETURN_RECEIPT]: 'Came back from a shop',
    [StockMovementType.RETURN_RESTOCK]: 'Returned to the shelf',
    [StockMovementType.RETURN_DAMAGED]: 'Returned damaged',
    [StockMovementType.RETURN_EXPIRED]: 'Returned expired',
    [StockMovementType.RETURN_QUARANTINED]: 'Returned and held back',
  } as Record<StockMovementType, string>,

  returnDetail: {
    loading: 'Loading this return',
    couldNotLoad: 'This return could not be loaded.',
    requestedBy: 'Requested {{when}} by {{who}}',
    requestedOn: 'Requested {{when}}',
    all: 'All returns',
    requestedValue: 'Value requested',
    creditSubtotal: 'Credit before tax',
    creditTax: 'Tax on the credit',
    creditTotal: 'Credit total',
    references: 'What this is against',
    order: 'Order',
    mainReason: 'Main reason',
    progress: 'Where it has got to',
    reviewed: 'Reviewed',
    collected: 'Collected',
    received: 'Received',
    creditNote: 'Credit note',
    notYet: 'Not yet',
    notIssued: 'Not issued yet',
    customerNotes: 'What the customer told us',
    rejectionReason: 'Why it was refused',
    internalNotes: 'Internal notes',
    items: 'What is coming back',
    columnInvoiced: 'Sent',
    columnRequested: 'Asked to return',
    columnApproved: 'Agreed',
    columnReceived: 'Received',
    columnDisposition: 'Where it went',
    columnCredit: 'Credit',
    restocked: '{{count}} back on the shelf',
    damaged: '{{count}} damaged',
    expiredUnits: '{{count}} expired',
    quarantined: '{{count}} held back',
    reviewTitle: 'Decide this return',
    mobileApprovesInFull:
      'Agreeing here accepts every unit the shop asked to return. To agree to only some of them, use the web application.',
    reviewBody: 'Agree the quantities you accept. Agreeing to none records the return as refused.',
    approveColumn: 'Agree to',
    approvedFor: 'Quantity agreed for {{brand}}',
    reviewNotes: 'Notes on this decision',
    startReview: 'Start reviewing',
    claiming: 'Starting…',
    saveDecision: 'Save this decision',
    saving: 'Saving…',
    rejectReturn: 'Refuse the return',
    rejecting: 'Refusing…',
    rejectionLabel: 'Why you are refusing it',
    receiveTitle: 'Receive and check',
    receiveBody:
      'Record where each unit goes. Only units put back on the shelf return to saleable stock, and an expired batch cannot go back.',
    restock: 'Back on the shelf',
    damagedColumn: 'Damaged',
    expiredColumn: 'Expired',
    quarantineColumn: 'Held back',
    countedOf: '{{counted}} of {{approved}}',
    dispositionFor: '{{field}} quantity for {{brand}}',
    confirmReceipt: 'Confirm what arrived',
    bookingIn: 'Booking in…',
    actions: 'What you can do',
    markCollected: 'Mark as collected',
    issueCreditNote: 'Issue the credit note',
    issuing: 'Issuing…',
    cancelReturn: 'Cancel this return',
    cancelling: 'Cancelling…',
    noActions: 'There is nothing for your role to do at this stage.',
    confirmCreditTitle: 'Issue a credit note for {{amount}}?',
    confirmCreditBody:
      'This posts to the customer’s account straight away and cannot be edited afterwards. The amount comes off what they owe.',
    cancelTitle: 'Cancel this return request',
    cancelBody:
      'The claim against the invoice is released, so the invoice goes back to being due in full.',
    cancelConfirm: 'Cancel the return',
    claimed: 'You are now reviewing this return.',
    decisionSaved: 'Decision saved.',
    rejected: 'Return refused.',
    collectedDone: 'Marked as collected from the shop.',
    receivedDone: 'Goods received and stock updated.',
    creditIssued: 'Credit note issued and posted to the account.',
    cancelled: 'Return cancelled.',
    actionFailed: 'That could not be done.',
  },

  account: {
    title: 'Your account',
    subtitle: 'Invoices, payments, what is outstanding and what credit is left.',
    paymentHistory: 'Payment history',
    statement: 'Account statement',
    loading: 'Loading your account',
    couldNotLoad: 'Your account could not be loaded.',
    invoices: 'Invoices',
    noInvoices: 'No invoices have been issued yet.',
    invoiceDate: 'Issued',
    remaining: 'Still owing',
    document: 'Invoice',
    openPdf: 'Open the invoice',
    pdfFailed: 'That invoice could not be opened.',
    recentPayments: 'Recent payments',
    viewAll: 'See all',
    noPayments: 'No payments recorded yet.',
    creditBlockedTitle: 'New credit orders are blocked',
    creditBlockedBody: 'Speak to your account manager. Settling what is overdue lifts the block.',
    contactManager: 'Contact your account manager.',
    seeWhatIsOwed: 'See what is owed',
    noShopLinked: 'No shop is linked to this sign-in',
    noShopLinkedBody: 'Ask an administrator to link your account to a shop.',
    currentDue: 'Currently due',
    overdue: 'Overdue',
    availableCredit: 'Credit left',
    creditLimit: 'Credit limit',
    creditUsed: 'Credit used',
    paymentTerms: 'Payment terms',
    days: '{{count}} days',
    records: 'Account records',
  },

  statement: {
    title: 'Account statement',
    ownTitle: 'Your statement',
    subtitle: 'Opening balance through to closing balance for the period you choose.',
    from: 'From',
    to: 'To',
    generate: 'Show the statement',
    print: 'Print or save as PDF',
    loading: 'Preparing the statement',
    couldNotLoad: 'This statement could not be prepared.',
    openingBalance: 'Opening balance',
    closingBalance: 'Closing balance',
    noEntries: 'Nothing happened on this account in that period.',
    description: 'What it was',
    debit: 'Charged',
    credit: 'Paid or credited',
    balance: 'Balance',
    period: 'Statement period',
    invalidRange: 'Enter the dates as YYYY-MM-DD, with the first before the second.',
    dateHint: 'YYYY-MM-DD',
  },

  notifications: {
    title: 'Notifications',
    subtitle: 'What has happened that you asked to be told about.',
    /*
     * The bell panel. These were nine hard-coded English strings in
     * `NotificationBell.tsx`, on the one component that renders on every
     * screen — so switching the application to Bangla left the first thing
     * anybody looks at in English, which reads as the switch being broken.
     */
    bellNone: 'Notifications, none unread',
    bellUnread: 'Notifications, {{count}} unread',
    recent: 'Recent',
    bellMarkAllRead: 'Mark all read',
    bellLoading: 'Fetching your notifications',
    bellEmpty: 'Nothing yet',
    bellEmptyBody: 'You will be told here when something needs your attention.',
    viewAll: 'View all notifications',
    justNow: 'just now',
    minutesAgo: '{{count}}m ago',
    hoursAgo: '{{count}}h ago',
    loading: 'Loading your notifications',
    couldNotLoad: 'Your notifications could not be loaded.',
    none: 'Nothing to catch up on',
    noneBody: 'You will be told here when something needs your attention.',
    markAllRead: 'Mark everything as read',
    markRead: 'Mark as read',
    unreadOnly: 'Unread only',
    all: 'Everything',
    preferences: 'Choose what you are told about',
    preferencesTitle: 'Notification settings',
    preferencesSubtitle: 'Choose which events reach you, and how.',
    loadingPreferences: 'Loading your settings',
    couldNotLoadPreferences: 'Your notification settings could not be loaded.',
    saved: 'Saved.',
    saveFailed: 'Those settings could not be saved.',
    event: 'What happened',
    allCategories: 'Everything',
    category: 'Category',
    markPageRead: 'Mark these as read',
    archive: 'Archive',
    read: 'Read',
    unread: 'Unread',
    markedRead: 'Marked as read.',
    archived: 'Archived.',
    updateFailed: 'Those notifications could not be updated.',
    allCaughtUp: 'You have read everything here',
    noneInCategory: 'Nothing in this category yet',
    pushOnThisDevice: 'Phone alerts on this device',
    pushOnThisDeviceBody:
      'Turning this on stores this phone against your account so alerts can reach it. Signing out removes it again.',
    enablePush: 'Turn on alerts for this phone',
    pushRegistered: 'This phone will now receive alerts.',
    pushDenied:
      'The phone refused permission. Turn notifications on for MedSupply in your phone’s settings.',
    quietHours: 'Quiet hours',
    quietHoursBody:
      'Phone alerts, SMS and WhatsApp are held back during these hours. Email still arrives, and anything urgent — a delivery code, for instance — always comes through.',
    quietHoursEnable: 'Hold messages during these hours',
    quietFrom: 'From',
    quietTo: 'To',
    channelsByEvent: 'What reaches you, and how',
    inAppAlways: 'You always see these in the app. These settings are about everything else.',
    mute: 'Mute',
    muteEvent: 'Mute {{event}}',
    channelForEvent: '{{channel}} for {{event}}',
    save: 'Save these settings',
    discard: 'Undo my changes',
    unavailable: 'These settings are not available.',
  },

  /** The five ways a message can reach somebody. */
  notificationChannel: {
    [NotificationChannel.IN_APP]: 'In the app',
    [NotificationChannel.EMAIL]: 'Email',
    [NotificationChannel.SMS]: 'SMS',
    [NotificationChannel.PUSH]: 'Phone alert',
    [NotificationChannel.WHATSAPP]: 'WhatsApp',
  } as Record<NotificationChannel, string>,

  notificationCategory: {
    [NotificationCategory.ORDER]: 'Orders',
    [NotificationCategory.APPROVAL]: 'Approvals',
    [NotificationCategory.FULFILMENT]: 'Picking and packing',
    [NotificationCategory.DELIVERY]: 'Deliveries',
    [NotificationCategory.FINANCE]: 'Money',
    [NotificationCategory.INVENTORY]: 'Stock',
    [NotificationCategory.SECURITY]: 'Security',
    [NotificationCategory.SYSTEM]: 'System',
  } as Record<NotificationCategory, string>,

  /**
   * `Record<ReturnReason, string>`, so a new reason in the shared types fails
   * the build here rather than reaching a shop owner as `COLD_CHAIN_BREACH`.
   */
  returnReason: {
    [ReturnReason.DAMAGED_IN_TRANSIT]: 'Damaged on the way',
    [ReturnReason.EXPIRED]: 'Past its expiry date',
    [ReturnReason.NEAR_EXPIRY]: 'Too close to its expiry date',
    [ReturnReason.WRONG_ITEM]: 'The wrong item was sent',
    [ReturnReason.EXCESS_QUANTITY]: 'More was sent than ordered',
    [ReturnReason.QUALITY_COMPLAINT]: 'Something is wrong with it',
    [ReturnReason.COLD_CHAIN_BREACH]: 'It was not kept cold',
    [ReturnReason.ORDER_ERROR]: 'We ordered it by mistake',
    [ReturnReason.OTHER]: 'Something else',
  } as Record<ReturnReason, string>,

  /**
   * `Record<PaymentMethod, string>` for the same reason the status maps are:
   * a new method added to the shared types fails the build here until it has
   * words. `Checkout.tsx` rendered these with `replaceAll('_', ' ')`, which
   * gave a shop owner "MOBILE FINANCIAL SERVICE" to choose from.
   */
  paymentMethod: {
    [PaymentMethod.CASH]: 'Cash',
    [PaymentMethod.BANK_TRANSFER]: 'Bank transfer',
    [PaymentMethod.MOBILE_FINANCIAL_SERVICE]: 'bKash, Nagad or similar',
    [PaymentMethod.CHEQUE]: 'Cheque',
    [PaymentMethod.CREDIT]: 'On account',
    [PaymentMethod.ADVANCE_BALANCE]: 'From money already paid',
    [PaymentMethod.OTHER]: 'Something else',
  } as Record<PaymentMethod, string>,

  nav: {
    sections: 'Sections',
    breadcrumb: 'Where you are',
    searchSections: 'Search sections',
    goTo: 'Go to…',
    myAccount: 'My account',
    appearance: 'Appearance',
    language: 'Language',
    light: 'Light',
    dark: 'Dark',
    system: 'Follow my device',
    skipToContent: 'Skip to the main content',
    collapseSidebar: 'Narrow the menu',
  },

  /**
   * The titles in the mobile stack's own header bar.
   *
   * Separate from `nav`, which names the sections of the web shell, and
   * separate again from `@medsupply/navigation`, whose tab labels are shared
   * between the two clients and are still English in both languages. These are
   * the seventeen headers a rider or a storekeeper reads at the top of a pushed
   * screen, and they were the last hard-coded English on that client's chrome.
   */
  /**
   * The sidebar, the tab bar and the search results.
   *
   * `NAV_ITEMS` and `NAV_GROUP_LABEL` carry English labels because
   * `@medsupply/navigation` is shared with a client that has no catalogue
   * dependency and must stay plain data. That meant the one part of the
   * interface present on **every** screen — the navigation itself — stayed in
   * English when the language was switched, which reads as the switch being
   * broken rather than as a translation gap.
   *
   * Keyed by the navigation id, so a renamed label does not silently orphan a
   * translation, and an id with no entry falls back to the English label rather
   * than rendering a dotted path.
   */
  navGroup: {
    work: 'Work',
    catalogue: 'Catalogue',
    purchasing: 'Buying in',
    money: 'Money',
    insight: 'Reports',
    administration: 'Administration',
    account: 'My account',
  } as Record<string, string>,

  /**
   * Whether a pharmacist has to see a prescription first.
   *
   * The medicine page rendered `item.classification` straight from the record,
   * so it printed the word PRESCRIPTION in capitals at whoever opened it —
   * the same defect the status wording rule exists to stop, in the one place
   * that rule was not looking.
   */
  /**
   * The pickers every form shares.
   *
   * One set of words, because the act is the same wherever it happens: type
   * enough to narrow the list, choose, or make the record that is not there.
   */
  /**
   * Where a delivery goes.
   *
   * A shop's addresses were set by the seed script and by nothing else — no
   * screen anywhere could append one — and a customer with no address cannot
   * order at all.
   */
  addresses: {
    add: 'Add this address',
    added: '{{label}} has been added.',
    addFailed: 'This address could not be added.',
    addTitle: 'Add a delivery address',
    addBody: 'It is saved against the customer, so it is there for every later order too.',
    addButton: 'Add an address',
    label: 'What to call it',
    labelHint: 'How the rider will recognise it — "Shop front", "Back godown".',
    line1: 'Street address',
    line2: 'Area or landmark',
    city: 'City',
    district: 'District',
    postalCode: 'Post code',
    line1Hint: 'At least five characters — enough for a rider to find it.',
  },

  pickers: {
    medicinePlaceholder: 'Type a brand name or a stock code',
    supplierPlaceholder: 'Type a supplier name',
    customerPlaceholder: 'Type a shop name, phone or reference',
    chosen: 'Chosen: {{name}}',
    medicineCreated: 'It goes straight onto this form once you save it.',
  },

  classification: {
    PRESCRIPTION: 'On prescription',
    OTC: 'Over the counter',
  },

  productType: {
    MEDICINE: 'Medicine',
    SUPPLEMENT: 'Supplement',
    PERSONAL_CARE: 'Personal care',
    BABY_CARE: 'Baby and mother care',
    FOOD: 'Food and drink',
    HERBAL: 'Herbal',
    HOMEOPATHY: 'Homeopathy',
    HOME_CARE: 'Household',
    VETERINARY: 'Veterinary',
    DEVICE: 'Device',
  },

  navItem: {
    'order-entry': 'Take an order',
    'price-lists': 'Price lists',
    'price-list-new': 'Add a price list',
    'price-list-detail': 'Price list',
    schemes: 'Free-goods offers',
    'scheme-new': 'Add an offer',
    'scheme-detail': 'Offer',
    dashboard: 'Home',
    orders: 'Orders',
    'order-detail': 'Order',
    approvals: 'Approvals',
    'approval-review': 'Review order',
    fulfilment: 'Picking',
    'fulfilment-work': 'Pick list',
    'fulfilment-ready': 'Ready to hand over',
    trips: 'Delivery rounds',
    'trip-new': 'Plan a round',
    'trip-detail': 'Delivery round',
    deliveries: 'Deliveries',
    'delivery-detail': 'Delivery',
    returns: 'Returns',
    'return-detail': 'Return',
    'return-new': 'Request a return',
    medicines: 'Medicines',
    'medicine-detail': 'Medicine',
    'medicine-new': 'Add a medicine',
    'medicine-edit': 'Edit this medicine',
    warehouses: 'Warehouses',
    'warehouse-new': 'Add a warehouse',
    inventory: 'Stock',
    stocktakes: 'Stock counts',
    'stocktake-new': 'Start a count',
    'stocktake-detail': 'Stock count',
    cart: 'Cart',
    checkout: 'Checkout',
    payments: 'Payments',
    'payment-detail': 'Payment',
    'payment-new': 'Record a payment',
    collections: 'Rider collections',
    'shop-ledger': 'Customer ledger',
    'shop-statement': 'Customer statement',
    'report-outstanding': 'Outstanding money',
    'report-overdue': 'Overdue money',
    'report-collections': 'Collection summary',
    suppliers: 'Suppliers',
    'supplier-new': 'Add a supplier',
    'purchase-orders': 'Purchase orders',
    'purchase-order-new': 'Raise a purchase order',
    'purchase-order-detail': 'Purchase order',
    recall: 'Trace a batch',
    'controlled-register': 'Prescription register',
    analytics: 'Overview',
    'analytics-sales': 'Sales report',
    'analytics-returns': 'Returns report',
    'analytics-inventory': 'Stock report',
    'analytics-deliveries': 'Delivery report',
    'analytics-receivables': 'Receivables report',
    shops: 'Shops',
    'shop-detail': 'Shop',
    'shop-new': 'Add a shop',
    users: 'People',
    'user-new': 'Add a person',
    settings: 'Settings',
    audit: 'Audit log',
    'shop-account': 'My account',
    'my-payments': 'My payments',
    'my-payment-detail': 'Payment',
    'my-statement': 'My statement',
    notifications: 'Notifications',
    'notification-preferences': 'Notification settings',
    activity: 'Activity',
    'change-password': 'Change your password',
    security: 'Sign-in and security',
  } as Record<string, string>,

  screens: {
    medicineDetails: 'Medicine details',
    checkout: 'Checkout',
    orderDetails: 'Order details',
    reviewOrder: 'Review order',
    pickingAndPacking: 'Picking and packing',
    deliveryDetails: 'Delivery details',
    proofOfDelivery: 'Proof of delivery',
    returnDetails: 'Return details',
    notificationPreferences: 'Notification preferences',
    invoices: 'Invoices',
    paymentHistory: 'Payment history',
    accountStatement: 'Account statement',
    overdueShops: 'Overdue shops',
    collectionReview: 'Collection review',
    myCollections: 'My collections',
    paymentDetails: 'Payment details',
  },

  /**
   * Adding somebody to the system.
   *
   * "A person", not "a user": the word for somebody who drives a van is not
   * "user", and the screen that creates a rider is the same screen either way.
   */
  people: {
    addTitle: 'Add a person',
    addSubtitle: 'They sign in with the email below and choose their own password the first time.',
    directory: 'Everybody',
    firstName: 'First name',
    lastName: 'Last name',
    email: 'Email',
    emailHint: 'This is what they sign in with.',
    emailHelp:
      'It has to be different from everybody else’s, and it is where anything sent to them goes. It cannot be changed here afterwards.',
    password: 'A password to start with',
    passwordHint: 'At least 8 characters. They will be asked to change it when they first sign in.',
    passwordHelp:
      'Type something and tell it to them once. They set their own the first time they sign in, so this one stops working almost immediately — never reuse a password of your own.',
    role: 'What they do',
    roleHelp:
      'This decides every screen they can open. You can only give somebody a job at or below your own, so the list here is already what you are allowed to choose from.',
    about: 'About {{field}}',
    add: 'Add this person',
    added: '{{name}} can sign in now.',
    addFailed: 'This person could not be added.',
    addRider: 'Add a delivery person',
    addRiderTitle: 'Add a delivery person',
    addRiderBody: 'They will be on the list as soon as you save, with nothing else to fill in.',
  },

  roles: {
    [UserRole.SUPER_ADMIN]: 'Super administrator',
    [UserRole.ADMIN]: 'Administrator',
    [UserRole.MANAGER]: 'Manager',
    [UserRole.STOREKEEPER]: 'Storekeeper',
    [UserRole.DELIVERY_PERSON]: 'Delivery person',
    [UserRole.SALES]: 'Sales representative',
    [UserRole.SHOP_OWNER]: 'Shop owner',
  } as Record<UserRole, string>,

  orderStatus: {
    [OrderStatus.DRAFT]: 'Draft',
    [OrderStatus.SUBMITTED]: 'Awaiting approval',
    [OrderStatus.UNDER_REVIEW]: 'Being reviewed',
    [OrderStatus.ON_HOLD]: 'On hold',
    [OrderStatus.APPROVED]: 'Approved',
    [OrderStatus.PARTIALLY_APPROVED]: 'Partly approved',
    [OrderStatus.REJECTED]: 'Rejected',
    [OrderStatus.PREPARING]: 'Being picked',
    [OrderStatus.PACKING]: 'Being packed',
    [OrderStatus.PACKED]: 'Packed',
    [OrderStatus.INVOICE_GENERATED]: 'Invoice ready',
    [OrderStatus.READY_FOR_DELIVERY]: 'Ready for delivery',
    [OrderStatus.DELIVERY_ASSIGNED]: 'Rider assigned',
    [OrderStatus.HANDED_TO_DELIVERY]: 'With the rider',
    [OrderStatus.PICKED_UP]: 'Collected from store',
    [OrderStatus.OUT_FOR_DELIVERY]: 'On the way',
    [OrderStatus.DELIVERED]: 'Delivered',
    [OrderStatus.PARTIALLY_DELIVERED]: 'Partly delivered',
    [OrderStatus.DELIVERY_FAILED]: 'Delivery failed',
    [OrderStatus.CANCELLED]: 'Cancelled',
    [OrderStatus.RETURN_REQUESTED]: 'Return requested',
    [OrderStatus.RETURNED]: 'Returned',
  } as Record<OrderStatus, string>,

  deliveryStatus: {
    [DeliveryStatus.READY_FOR_ASSIGNMENT]: 'Needs a rider',
    [DeliveryStatus.ASSIGNED]: 'Rider assigned',
    [DeliveryStatus.HANDED_OVER]: 'Handed to rider',
    [DeliveryStatus.PICKED_UP]: 'Collected',
    [DeliveryStatus.OUT_FOR_DELIVERY]: 'On the way',
    [DeliveryStatus.ARRIVED]: 'At the shop',
    [DeliveryStatus.DELIVERED]: 'Delivered',
    [DeliveryStatus.PARTIALLY_DELIVERED]: 'Partly delivered',
    [DeliveryStatus.FAILED]: 'Failed',
    [DeliveryStatus.RETURNING]: 'Coming back',
    [DeliveryStatus.RETURNED_TO_STORE]: 'Back at the store',
    [DeliveryStatus.CANCELLED]: 'Cancelled',
  } as Record<DeliveryStatus, string>,

  paymentStatus: {
    [PaymentStatus.PENDING]: 'Not yet posted',
    [PaymentStatus.POSTED]: 'Posted',
    [PaymentStatus.FAILED]: 'Failed',
    [PaymentStatus.REVERSED]: 'Reversed',
  } as Record<PaymentStatus, string>,

  returnStatus: {
    [ReturnStatus.REQUESTED]: 'Requested',
    [ReturnStatus.UNDER_REVIEW]: 'Being reviewed',
    [ReturnStatus.APPROVED]: 'Approved',
    [ReturnStatus.PARTIALLY_APPROVED]: 'Partly approved',
    [ReturnStatus.REJECTED]: 'Rejected',
    [ReturnStatus.COLLECTED]: 'Collected',
    [ReturnStatus.RECEIVED]: 'Received',
    [ReturnStatus.COMPLETED]: 'Completed',
    [ReturnStatus.CANCELLED]: 'Cancelled',
  } as Record<ReturnStatus, string>,

  /**
   * `Record<PurchaseOrderStatus, string>` — a new status in the shared types is
   * a build failure here rather than a `PARTIALLY_RECEIVED` on a storekeeper's
   * screen.
   */
  purchaseOrderStatus: {
    [PurchaseOrderStatus.DRAFT]: 'Draft',
    [PurchaseOrderStatus.ISSUED]: 'Sent to the supplier',
    [PurchaseOrderStatus.PARTIALLY_RECEIVED]: 'Part of it has arrived',
    [PurchaseOrderStatus.RECEIVED]: 'All of it has arrived',
    [PurchaseOrderStatus.CANCELLED]: 'Called off',
  } as Record<PurchaseOrderStatus, string>,

  /** `Record<StocktakeStatus, string>`. */
  stocktakeStatus: {
    [StocktakeStatus.COUNTING]: 'Being counted',
    [StocktakeStatus.REVIEW]: 'Waiting to be approved',
    [StocktakeStatus.POSTED]: 'Posted',
    [StocktakeStatus.ABANDONED]: 'Abandoned',
  } as Record<StocktakeStatus, string>,

  /** `Record<TripStatus, string>`. */
  tripStatus: {
    [TripStatus.PLANNED]: 'Planned',
    [TripStatus.IN_PROGRESS]: 'Out now',
    [TripStatus.COMPLETED]: 'Finished',
    [TripStatus.CANCELLED]: 'Called off',
  } as Record<TripStatus, string>,

  shopStatus: {
    [ShopStatus.PENDING]: 'Awaiting approval',
    [ShopStatus.ACTIVE]: 'Active',
    [ShopStatus.INACTIVE]: 'Inactive',
    [ShopStatus.SUSPENDED]: 'Suspended',
    [ShopStatus.CREDIT_BLOCKED]: 'Credit blocked',
    [ShopStatus.LICENCE_EXPIRED]: 'Licence expired',
  } as Record<ShopStatus, string>,

  /**
   * The invoice's own two states.
   *
   * Not derived from a const-object the way the others are, because there is
   * no `InvoiceStatus` in `@medsupply/shared-types` — the model declares the
   * enum inline at `apps/api/src/models/Invoice.ts:32`. Recorded here rather
   * than invented per screen; promoting it to a shared const-object would make
   * this a compile-time record like the rest, and is worth doing when something
   * else needs it.
   */
  handoverStatus: {
    [CollectionHandoverStatus.NOT_REQUIRED]: 'Not needed',
    [CollectionHandoverStatus.PENDING]: 'Waiting to hand over',
    [CollectionHandoverStatus.HANDED_OVER]: 'Handed over',
  } as Record<CollectionHandoverStatus, string>,

  analyticsMobile: {
    rangeLabel: 'Which period',
    last7: 'Last 7 days',
    thisMonth: 'This month',
    last90: 'Last 90 days',
    loading: 'Loading the figures',
    couldNotLoad: 'The business figures could not be loaded.',
    none: 'No figures for this period',
    noneBody: 'Nothing was invoiced between these dates.',
    sales: 'Sales',
    netSales: 'Net sales',
    afterReturns: 'After returns',
    invoices: 'Invoices',
    averageInvoice: 'Average invoice',
    receivables: 'What is owed',
    outstanding: 'Outstanding',
    overdue: 'Overdue',
    orders: 'Orders',
    submitted: 'Sent',
    approved: 'Approved',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
    delivery: 'Delivery',
    successRate: 'Delivered first time',
    onTime: 'On time',
    failed: 'Failed',
    averageCycle: 'Average time to deliver',
    hours: '{{count}} h',
    returns: 'Returns',
    credited: 'Credited',
    awaitingCredit: 'Awaiting credit',
    returnRate: 'Return rate',
    openRequests: 'Open requests',
    topMedicines: 'Best sellers',
    nothingSold: 'Nothing was sold in this period.',
  },

  invoiceStatus: {
    ISSUED: 'Issued',
    CANCELLED: 'Cancelled',
  } as Record<string, string>,

  userStatus: {
    [UserStatus.ACTIVE]: 'Active',
    [UserStatus.INACTIVE]: 'Inactive',
    [UserStatus.SUSPENDED]: 'Suspended',
  } as Record<UserStatus, string>,

  /**
   * Server error codes, in words the person reading them can act on.
   *
   * These were rendered verbatim: a shop owner whose order exceeded their limit
   * was shown `CREDIT_LIMIT_EXCEEDED`. Each of these says what happened and what
   * to do about it, because an error a user cannot act on is a support call.
   */
  errors: {
    UNAUTHORIZED: 'You have been signed out. Sign in again to carry on.',
    FORBIDDEN: 'Your account does not have permission to do that.',
    NOT_FOUND: 'That could not be found. It may have been removed.',
    /*
     * Deliberately not the sentence above. `NOT_FOUND` means the record is
     * gone; this means the *address* is not served, which is a different fact
     * with a different remedy. Until this code existed, a browser running
     * against a server too old to have `/trips` told a distributor their
     * delivery rounds had been deleted.
     */
    NO_SUCH_ENDPOINT:
      'This screen asked the server for something it does not offer. Reload the page — if it keeps happening, the server is running an older version than this app.',
    RATE_LIMITED: 'Too many attempts. Wait a minute and try again.',
    VALIDATION_ERROR: 'Some of what was entered is not valid. Check the highlighted fields.',
    CREDIT_LIMIT: 'This order would take the shop past its credit limit.',
    CREDIT_BLOCKED: 'This shop’s account is blocked, so new orders cannot be approved.',
    CREDIT_OVERRIDE_FORBIDDEN:
      'Only an administrator can approve an order past its credit limit. Ask one to review it.',
    CREDIT_OVERRIDE_REASON_REQUIRED: 'Write down why this order is being approved anyway.',
    INSUFFICIENT_STOCK: 'There is not enough stock on the shelf for this quantity.',
    STALE_ORDER: 'Somebody else changed this order while you were looking at it. It has reloaded.',
    STALE_VERSION: 'Somebody else changed this while you were looking at it. It has reloaded.',
    STALE_SETTINGS: 'Somebody else changed these settings. The latest values have been reloaded.',
    STALE_RETURN: 'Somebody else updated this return while you were looking at it.',
    CONCURRENT_STOCK_CHANGE: 'The stock changed while this was being saved. Try again.',
    CANCELLATION_NOT_ALLOWED:
      'This order has gone too far to cancel. Raise a return instead, so the invoice is credited and the goods come back.',
    NO_CANCELLATION_REQUEST: 'Nobody has asked for this order to be cancelled.',
    PASSWORD_CHANGE_REQUIRED: 'Choose a new password before carrying on.',
    CURRENT_PASSWORD_INCORRECT: 'That is not your current password.',
    PASSWORD_TOO_SHORT: 'That password is too short.',
    PASSWORD_UNCHANGED: 'Choose a password you have not just been using.',
    LICENCE_EXPIRED: 'This shop’s drug licence has expired, so orders cannot be approved.',
    SHOP_BLOCKED: 'This shop’s account is not active.',
    DUPLICATE_ITEM: 'The same medicine appears twice in this order.',
    QUANTITY_INVALID: 'That quantity is outside the limits set for this medicine.',
    MEDICINE_UNAVAILABLE: 'One of the medicines in this order is no longer available.',
    UNKNOWN: 'Something went wrong. Try again, and tell support if it keeps happening.',
  } as Record<string, string>,
  /*
   * No `as const`. It would make every value a *literal* type, so `bn.ts`
   * typed against this could only satisfy it by repeating the English words —
   * the compiler would demand 'Loading', not 'লোড হচ্ছে'. The property names
   * are still fixed by the object literal, which is the guarantee that matters:
   * a key added here and forgotten in Bangla is still a compile error.
   */
};

export type Catalogue = typeof en;
