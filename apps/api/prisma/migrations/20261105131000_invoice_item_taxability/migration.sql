UPDATE "InvoiceItem" li SET "taxable"=(i."billingSnapshot"->'pricing'->'tax'->>'taxable')::boolean
 FROM "Invoice" i WHERE li."invoiceId"=i."id" AND i."kind"='HOSTING'
 AND jsonb_typeof(i."billingSnapshot"->'pricing'->'tax'->'taxable')='boolean';
