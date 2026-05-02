-- Finance Module — COA seed
-- Seeded from Bukku export (celsius.bukku.my/accounting/accounts) on 2026-05-02.
-- After this migration, the in-house module owns the COA. Future changes go
-- through agentic flows + admin UI, not Bukku.
--
-- type values: asset|liability|equity|income|cogs|expense
-- subtype mirrors Bukku's "system account" hint where present.

insert into fin_accounts (code, name, type, subtype, parent_code, is_system, outlet_specific) values
  -- ─── Current Assets ──────────────────────────────────────
  ('1000',    'Cash & Cash Equivalents',                    'asset', 'bank_cash',         null,   true,  false),
  ('1000-01', 'Bank Account',                               'asset', 'bank_cash',         '1000', true,  false),
  ('1000-02', 'Cash on Hand',                               'asset', 'bank_cash',         '1000', true,  true),
  ('1000-03', 'Bank Account 2',                             'asset', 'bank_cash',         '1000', true,  false),
  ('1001',    'Accounts Receivable',                        'asset', 'ar',                null,   true,  false),
  ('1001-00', 'Account receivables',                        'asset', 'ar',                '1001', true,  false),
  ('1002',    'Inventory',                                  'asset', 'inventory',         null,   true,  true),
  ('1003',    'Deposit and prepayment',                     'asset', null,                null,   false, false),
  ('1004',    'Due From Directors',                         'asset', null,                null,   false, false),
  ('1005',    'Grabfood debtors',                           'asset', 'ar',                null,   true,  true),
  ('1006',    'Debit/credit card debtors',                  'asset', 'ar',                null,   true,  true),
  ('1007',    'Voucher debtor',                             'asset', 'ar',                null,   true,  true),

  -- ─── Non-Current Assets (PP&E) ───────────────────────────
  ('1500',    'Property, Plant & Equipment',                'asset', 'fixed_asset',       null,   true,  false),
  ('1500-00', 'Coffee machines',                            'asset', 'fixed_asset',       '1500', false, true),
  ('1500-01', 'Furniture and fittings',                     'asset', 'fixed_asset',       '1500', false, true),
  ('1500-02', 'Kitchen equipment',                          'asset', 'fixed_asset',       '1500', false, true),
  ('1500-03', 'Office equipment',                           'asset', 'fixed_asset',       '1500', false, false),
  ('1500-04', 'Renovation',                                 'asset', 'fixed_asset',       '1500', false, true),
  ('1500-05', 'Signboard',                                  'asset', 'fixed_asset',       '1500', false, true),
  ('1550',    'PP&E - Accumulated depreciation',            'asset', 'fixed_asset',       null,   true,  false),
  ('1550-00', 'Coffee machines - Accumulated depreciation', 'asset', 'fixed_asset',       '1550', true,  true),
  ('1550-01', 'Furniture and fittings - Accumulated depreciation', 'asset', 'fixed_asset','1550', true,  true),
  ('1550-02', 'Kitchen equipment - Accumulated depreciation','asset', 'fixed_asset',      '1550', true,  true),
  ('1550-03', 'Office equipment - Accumulated depreciation','asset', 'fixed_asset',       '1550', true,  false),
  ('1550-04', 'Renovation - Accumulated depreciation',      'asset', 'fixed_asset',       '1550', true,  true),
  ('1550-05', 'Signboard - Accumulated depreciation',       'asset', 'fixed_asset',       '1550', true,  true),

  -- ─── Current Liabilities ─────────────────────────────────
  ('3000',    'Credit Card Accounts',                       'liability', 'credit_card',   null,   true,  false),
  ('3001',    'Accounts Payable',                           'liability', 'ap',            null,   true,  false),
  ('3002',    'Other payables and accruals',                'liability', 'sst_payable',   null,   true,  false),
  ('3003',    'SST Deferred',                               'liability', 'sst_deferred',  null,   true,  false),
  ('3004',    'EPF Control',                                'liability', 'epf_control',   null,   true,  false),
  ('3005',    'SOCSO Control',                              'liability', 'socso_control', null,   true,  false),
  ('3006',    'EIS Control',                                'liability', 'eis_control',   null,   true,  false),
  ('3007',    'PCB Control',                                'liability', 'mtd_control',   null,   true,  false),
  ('3008',    'Salary Control',                             'liability', 'salary_control',null,   true,  false),
  ('3009',    'Goods Received Not Invoiced',                'liability', 'grni',          null,   true,  false),
  ('3010',    'Short-term Loans',                           'liability', null,            null,   false, false),
  ('3400',    'Due To Directors',                           'liability', null,            null,   false, false),

  -- ─── Non-Current Liabilities ─────────────────────────────
  ('3500',    'Long-term Loans',                            'liability', null,            null,   false, false),

  -- ─── Equity ──────────────────────────────────────────────
  ('4000',    'Retained Earnings',                          'equity',    'retained_earnings', null, true,  false),
  ('4001',    'Owner''s Share Capital',                     'equity',    null,            null,   true,  false),

  -- ─── Income ──────────────────────────────────────────────
  ('5000',    'Sales Income',                               'income',    null,            null,   true,  false),
  ('5000-01', 'Cash and QR sales',                          'income',    null,            '5000', true,  true),
  ('5000-02', 'Card',                                       'income',    null,            '5000', true,  true),
  ('5000-03', 'Freeflow/redeem/voucher/mulah',              'income',    null,            '5000', true,  true),
  ('5000-04', 'Grabfood',                                   'income',    null,            '5000', true,  true),
  ('5000-09', 'Vendors - GastroHub',                        'income',    null,            '5000', true,  true),
  ('5000-10', 'Meetings and events',                        'income',    null,            '5000', false, true),
  ('5001',    'Discount Given',                             'income',    'discount_given',null,   true,  true),

  -- ─── Other Income ────────────────────────────────────────
  ('5500',    'Interest Earned',                            'income',    null,            null,   false, false),

  -- ─── Cost of Sales ───────────────────────────────────────
  ('6000',    'Food cost',                                  'cogs',      null,            null,   true,  true),
  ('6000-01', 'COS Raw materials',                          'cogs',      null,            '6000', true,  true),
  ('6000-02', 'COS Trading',                                'cogs',      null,            '6000', true,  true),
  ('6001',    'Beverage Cost',                              'cogs',      null,            null,   true,  true),
  ('6001-01', 'COS Coffee Beans',                           'cogs',      null,            '6001', true,  true),
  ('6001-02', 'COS Base & Powder',                          'cogs',      null,            '6001', true,  true),
  ('6001-03', 'COS Syrups',                                 'cogs',      null,            '6001', true,  true),
  ('6001-04', 'COS Milks',                                  'cogs',      null,            '6001', true,  true),
  ('6001-05', 'COS Beverage Others',                        'cogs',      null,            '6001', true,  true),
  ('6002',    'Disposable & Packaging',                     'cogs',      null,            null,   true,  true),
  ('6003',    'Inventory Adjustment',                       'cogs',      null,            null,   true,  true),

  -- ─── Expenses ────────────────────────────────────────────
  ('6500',    'Salaries & Wages',                           'expense',   'salary_expense',null,   true,  false),
  ('6500-01', 'Directors Salaries',                         'expense',   'salary_expense','6500', true,  false),
  ('6500-02', 'Full timer staff',                           'expense',   'salary_expense','6500', true,  true),
  ('6500-03', 'Part timer staff',                           'expense',   'salary_expense','6500', true,  true),
  ('6501',    'Statutory Payment',                          'expense',   null,            null,   true,  false),
  ('6501-01', 'EPF - Employer''s Contribution',             'expense',   'epf_expense',   '6501', true,  false),
  ('6501-02', 'SOCSO - Employer''s Contribution',           'expense',   'socso_expense', '6501', true,  false),
  ('6501-03', 'EIS - Employer''s Contribution',             'expense',   'eis_expense',   '6501', true,  false),
  ('6502',    'Employee Benefits',                          'expense',   null,            null,   false, false),
  ('6502-01', 'Trainings',                                  'expense',   null,            '6502', false, false),
  ('6502-02', 'Meetings',                                   'expense',   null,            '6502', false, false),
  ('6502-03', 'Meal & Entertainment',                       'expense',   null,            '6502', false, false),
  ('6502-04', 'Travel',                                     'expense',   null,            '6502', false, false),
  ('6503',    'Marketing & Advertising',                    'expense',   null,            null,   false, false),
  ('6503-01', 'Digital Ads',                                'expense',   null,            '6503', false, false),
  ('6503-02', 'Rewards & Reviews',                          'expense',   null,            '6503', false, false),
  ('6503-03', 'KOL & Influencers',                          'expense',   null,            '6503', false, false),
  ('6503-04', 'Sponsorships',                               'expense',   null,            '6503', false, false),
  ('6504',    'Rental',                                     'expense',   null,            null,   true,  true),
  ('6505',    'Utilities',                                  'expense',   null,            null,   true,  true),
  ('6505-01', 'Electricity',                                'expense',   null,            '6505', true,  true),
  ('6505-02', 'Water',                                      'expense',   null,            '6505', true,  true),
  ('6505-03', 'Internet',                                   'expense',   null,            '6505', true,  true),
  ('6505-04', 'Telephone',                                  'expense',   null,            '6505', true,  true),
  ('6506',    'Maintenance and Repairs',                    'expense',   null,            null,   false, true),
  ('6507',    'Outlet Supplies',                            'expense',   null,            null,   false, true),
  ('6508',    'Software & Hardware',                        'expense',   null,            null,   false, false),
  ('6509',    'Research & Development',                     'expense',   null,            null,   false, false),
  ('6510',    'Compliance',                                 'expense',   null,            null,   false, false),
  ('6510-01', 'Insurance',                                  'expense',   null,            '6510', false, false),
  ('6510-02', 'License',                                    'expense',   null,            '6510', false, true),
  ('6510-03', 'Safety',                                     'expense',   null,            '6510', false, false),
  ('6511',    'Professional Fees',                          'expense',   null,            null,   false, false),
  ('6511-01', 'Company Secretary',                          'expense',   null,            '6511', false, false),
  ('6511-02', 'Accounting Fees',                            'expense',   null,            '6511', false, false),
  ('6511-03', 'Audit Fees',                                 'expense',   null,            '6511', false, false),
  ('6511-04', 'Legal Fees',                                 'expense',   null,            '6511', false, false),
  ('6511-05', 'Tax Agent Fees',                             'expense',   null,            '6511', false, false),
  ('6511-06', 'Management fees',                            'expense',   null,            '6511', false, false),
  ('6512',    'Depreciation of property, plant and equipment','expense', null,            null,   true,  false),
  ('6513',    'SST Expense',                                'expense',   'sst_expense',   null,   true,  false),
  ('6514',    'Bank Charges',                               'expense',   null,            null,   false, false),
  ('6515',    'Interest Paid',                              'expense',   null,            null,   false, false),
  ('6516',    'Rounding Loss',                              'expense',   'rounding_loss', null,   true,  false),
  ('6517',    'Exchange Loss',                              'expense',   'exchange_loss', null,   true,  false),
  ('6518',    'MTD - Employer''s Contribution',             'expense',   'mtd_expense',   null,   true,  false),
  ('6519',    'Merchant fees',                              'expense',   null,            null,   true,  true),
  ('6900',    'Taxation',                                   'expense',   null,            null,   true,  false)
on conflict (code) do nothing;
