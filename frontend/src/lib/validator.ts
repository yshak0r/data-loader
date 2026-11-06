import {
  CsvRow,
  ProcessedRow,
  ValidationError,
  LpnGroup,
} from '../types/dcloader';
import {
  DEFAULT_WAREHOUSES,
  DEFAULT_PRODUCTS,
  DEFAULT_BINS,
  DEFAULT_EXISTING_LOTS,
  DEFAULT_EXISTING_LPNS,
} from './catalog';

// Standard month abbreviations used in Ross ERP
const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/**
 * Standardize and validate Ross date format: DD-MMM-YYYY (e.g. 15-JAN-2027)
 * Also accepts ISO (2027-01-15) and standard slash formats (01/15/2027) and converts.
 */
export function normalizeRossDate(val: string): { normalized: string; valid: boolean; error?: string } {
  if (!val || !val.trim()) {
    return { normalized: '', valid: true };
  }

  let s = val.trim().toUpperCase();

  // Single digit day padding (e.g. 2-JAN-17 or 2-JAN-2017)
  const singleDigitDay = /^(\d)-([A-Z]{3})-(\d{2,4})$/;
  if (singleDigitDay.test(s)) {
    s = '0' + s;
  }

  // Two digit year conversion (e.g. 02-JAN-27 -> 02-JAN-2027)
  const twoDigitYear = /^(\d{2})-([A-Z]{3})-(\d{2})$/;
  const match2 = s.match(twoDigitYear);
  if (match2) {
    const yr = parseInt(match2[3], 10);
    const fullYr = yr < 50 ? 2000 + yr : 1900 + yr;
    s = `${match2[1]}-${match2[2]}-${fullYr}`;
  }

  // Validate DD-MMM-YYYY
  const standardPattern = /^(\d{2})-([A-Z]{3})-(\d{4})$/;
  const matchStd = s.match(standardPattern);
  if (matchStd) {
    const day = parseInt(matchStd[1], 10);
    const monStr = matchStd[2];
    const year = parseInt(matchStd[3], 10);

    if (MONTHS[monStr] === undefined) {
      return { normalized: s, valid: false, error: `Invalid month '${monStr}'. Expected 3-letter month (JAN..DEC)` };
    }
    if (day < 1 || day > 31) {
      return { normalized: s, valid: false, error: `Invalid day '${day}'. Day must be between 01 and 31` };
    }
    if (year < 1980 || year > 2100) {
      return { normalized: s, valid: false, error: `Year '${year}' is out of acceptable ERP range` };
    }
    return { normalized: s, valid: true };
  }

  // Attempt parse from YYYY-MM-DD
  const isoPattern = /^(\d{4})-(\d{2})-(\d{2})$/;
  const matchIso = s.match(isoPattern);
  if (matchIso) {
    const year = parseInt(matchIso[1], 10);
    const monIdx = parseInt(matchIso[2], 10) - 1;
    const day = parseInt(matchIso[3], 10);
    const monthKey = Object.keys(MONTHS)[monIdx];
    if (monthKey) {
      const paddedDay = day < 10 ? `0${day}` : `${day}`;
      return { normalized: `${paddedDay}-${monthKey}-${year}`, valid: true };
    }
  }

  return {
    normalized: s,
    valid: false,
    error: `Invalid date format '${val}'. Expected DD-MMM-YYYY (e.g. 15-OCT-2026)`,
  };
}

/**
 * Validates a single CSV record against Ross ERP business rules.
 */
export function validateRossRow(
  row: CsvRow,
  lineIndex: number,
  rawLine: string
): { isValid: boolean; errors: ValidationError[]; normalizedRow: CsvRow } {
  const errors: ValidationError[] = [];
  const normalized: CsvRow = { ...row };

  // 1. Warehouse Validation
  const whCode = (row.warehouse || '').trim();
  normalized.warehouse = whCode;
  const wh = DEFAULT_WAREHOUSES.find((w) => w.warehouse === whCode);

  if (!whCode) {
    errors.push({
      line: lineIndex,
      column: 'warehouse',
      fieldIndex: 1,
      code: 'ERR_WH_EMPTY',
      message: 'Warehouse code cannot be empty',
      severity: 'error',
      remediation: 'Specify a valid 2-character warehouse code (e.g., 10, 20).',
      rawLine,
      itemValue: whCode,
    });
  } else if (!wh) {
    errors.push({
      line: lineIndex,
      column: 'warehouse',
      fieldIndex: 1,
      code: 'ROSS_ERR_WH_NOT_FOUND',
      message: `Warehouse_Control Does Not Exist: '${whCode}'`,
      severity: 'error',
      remediation: `Configure warehouse '${whCode}' in Ross ERP or choose an existing DC warehouse (10, 20, 40).`,
      rawLine,
      itemValue: whCode,
    });
  } else if (!wh.dataCaptureInUse) {
    errors.push({
      line: lineIndex,
      column: 'warehouse',
      fieldIndex: 1,
      code: 'ROSS_ERR_NO_DC',
      message: `Warehouse_Controls Does Not Have Data Capture In Use for warehouse '${whCode}'`,
      severity: 'error',
      remediation: 'Use a Data Capture-enabled warehouse or activate DC module in Warehouse Controls.',
      rawLine,
      itemValue: whCode,
    });
  }

  // 2. Part Code Validation
  const partCode = (row.partCode || '').trim();
  normalized.partCode = partCode;
  const part = DEFAULT_PRODUCTS.find((p) => p.partCode === partCode);

  if (!partCode) {
    errors.push({
      line: lineIndex,
      column: 'partCode',
      fieldIndex: 2,
      code: 'ERR_PART_EMPTY',
      message: 'Part code cannot be empty',
      severity: 'error',
      remediation: 'Specify an active Product Master code.',
      rawLine,
      itemValue: partCode,
    });
  } else if (!part) {
    errors.push({
      line: lineIndex,
      column: 'partCode',
      fieldIndex: 2,
      code: 'ROSS_ERR_PART_NOT_FOUND',
      message: `Product_Master Does Not Exist: '${partCode}'`,
      severity: 'error',
      remediation: `Ensure item '${partCode}' exists in Product Master.`,
      rawLine,
      itemValue: partCode,
    });
  } else {
    if (!part.active) {
      errors.push({
        line: lineIndex,
        column: 'partCode',
        fieldIndex: 2,
        code: 'ROSS_ERR_PART_INACTIVE',
        message: `Product Master is not Activated: '${partCode}'`,
        severity: 'error',
        remediation: 'Activate the product in Product Master or select an active item.',
        rawLine,
        itemValue: partCode,
      });
    }

    // Check Product Warehouse assignment
    if (whCode && !part.warehouses.includes(whCode)) {
      errors.push({
        line: lineIndex,
        column: 'partCode',
        fieldIndex: 2,
        code: 'ROSS_ERR_PROD_WH_NOT_FOUND',
        message: `Product_Warehouse Does Not Exist for Wh '${whCode}' and Part '${partCode}'`,
        severity: 'error',
        remediation: `Assign product '${partCode}' to warehouse '${whCode}' in Product Warehouse controls.`,
        rawLine,
        itemValue: `${whCode}-${partCode}`,
      });
    }
  }

  // 3. Bin Location Validation
  const binLocation = (row.binLocation || '').trim();
  normalized.binLocation = binLocation;

  if (wh) {
    if (wh.binSizing) {
      if (!binLocation) {
        errors.push({
          line: lineIndex,
          column: 'binLocation',
          fieldIndex: 4,
          code: 'ROSS_ERR_BIN_REQUIRED',
          message: `Bin Location required for this Warehouse ('${whCode}')`,
          severity: 'error',
          remediation: `Warehouse '${whCode}' has Bin Sizing enabled. Provide an active bin (e.g. A-001, B-001).`,
          rawLine,
          itemValue: binLocation,
        });
      } else {
        const bin = DEFAULT_BINS.find((b) => b.warehouse === whCode && b.binLocation === binLocation);
        if (!bin) {
          errors.push({
            line: lineIndex,
            column: 'binLocation',
            fieldIndex: 4,
            code: 'ROSS_ERR_BIN_NOT_FOUND',
            message: `Bin_Location does not exist: '${whCode}-${binLocation}'`,
            severity: 'error',
            remediation: `Verify bin '${binLocation}' in Bin Locations master table for warehouse '${whCode}'.`,
            rawLine,
            itemValue: binLocation,
          });
        } else if (bin.status !== 'A') {
          errors.push({
            line: lineIndex,
            column: 'binLocation',
            fieldIndex: 4,
            code: 'ROSS_ERR_BIN_INACTIVE',
            message: `Bin_Location Is Not Active: '${whCode}-${binLocation}'`,
            severity: 'error',
            remediation: `Activate bin '${binLocation}' in warehouse '${whCode}' before loading inventory.`,
            rawLine,
            itemValue: binLocation,
          });
        }
      }
    } else {
      if (binLocation) {
        errors.push({
          line: lineIndex,
          column: 'binLocation',
          fieldIndex: 4,
          code: 'WARN_NON_BINNED_WH',
          message: `Warehouse '${whCode}' is non-binned; specified bin '${binLocation}' will be disregarded.`,
          severity: 'warning',
          remediation: `Clear bin location for non-binned warehouse '${whCode}'.`,
          rawLine,
          itemValue: binLocation,
        });
      }
    }
  }

  // 4. Lot Number Validation
  const lotNumber = (row.lotNumber || '').trim();
  normalized.lotNumber = lotNumber;

  if (part) {
    if (part.batchesExist) {
      if (!lotNumber) {
        errors.push({
          line: lineIndex,
          column: 'lotNumber',
          fieldIndex: 3,
          code: 'ROSS_ERR_LOT_REQUIRED',
          message: `IC_LOT_NUMBER Required for lotted product '${partCode}'`,
          severity: 'error',
          remediation: `Provide a batch/lot number up to 15 characters for item '${partCode}'.`,
          rawLine,
          itemValue: lotNumber,
        });
      } else if (lotNumber.length > 15) {
        errors.push({
          line: lineIndex,
          column: 'lotNumber',
          fieldIndex: 3,
          code: 'ROSS_ERR_LOT_LENGTH',
          message: `IC_LOT_NUMBER Not Valid Length: exceeds maximum 15 characters ('${lotNumber}')`,
          severity: 'error',
          remediation: 'Shorten lot number to 15 characters or fewer.',
          rawLine,
          itemValue: lotNumber,
        });
      }
    } else {
      if (lotNumber) {
        errors.push({
          line: lineIndex,
          column: 'lotNumber',
          fieldIndex: 3,
          code: 'WARN_NON_LOTTED_PART',
          message: `Product '${partCode}' is non-lotted; specified lot '${lotNumber}' will be cleared.`,
          severity: 'warning',
          remediation: `Leave lot number blank for non-lotted products.`,
          rawLine,
          itemValue: lotNumber,
        });
        normalized.lotNumber = '';
      }
    }
  }

  // 5. Status Code Validation
  const statusCode = (row.statusCode || '').trim().toUpperCase();
  normalized.statusCode = statusCode;
  if (!['QOH', 'QC', 'QR'].includes(statusCode)) {
    errors.push({
      line: lineIndex,
      column: 'statusCode',
      fieldIndex: 5,
      code: 'ROSS_ERR_INVALID_STATUS',
      message: `IC_STATUS_CODE Not Valid Lot Status: '${statusCode || '(blank)'}'`,
      severity: 'error',
      remediation: 'Allowed status codes: QOH (Quantity On Hand), QC (Quality Control), QR (Quarantine/Reject).',
      rawLine,
      itemValue: statusCode,
    });
  }

  // 6. Unit of Measure 1 & Packaged Validation
  const uom1 = (row.uom1 || '').trim().toUpperCase();
  normalized.uom1 = uom1;

  if (part) {
    if (part.packagedProduct) {
      if (uom1 === part.capacityUom) {
        errors.push({
          line: lineIndex,
          column: 'uom1',
          fieldIndex: 7,
          code: 'ROSS_ERR_PACK_UOM_REQUIRED',
          message: `Unit of Measure 1 must be Pack UOM, not base capacity UOM '${uom1}'`,
          severity: 'error',
          remediation: `Use valid pack UOM (e.g. ${part.validPackUoms?.join(', ') || 'CS'}) for packaged item '${partCode}'.`,
          rawLine,
          itemValue: uom1,
        });
      } else if (part.validPackUoms && !part.validPackUoms.includes(uom1)) {
        errors.push({
          line: lineIndex,
          column: 'uom1',
          fieldIndex: 7,
          code: 'P_71560',
          message: `P_71560: Unit of Measure 1 ('${uom1}') is not an authorized Pack UOM for '${partCode}'`,
          severity: 'error',
          remediation: `Valid Pack UOMs for this item: ${part.validPackUoms.join(', ')}.`,
          rawLine,
          itemValue: uom1,
        });
      }
    } else {
      if (uom1 && uom1 !== part.capacityUom) {
        errors.push({
          line: lineIndex,
          column: 'uom1',
          fieldIndex: 7,
          code: 'ROSS_ERR_UOM1_MISMATCH',
          message: `Unit of Measure '${uom1}' does not equal Product Master Capacity UOM '${part.capacityUom}'`,
          severity: 'error',
          remediation: `Change UOM_1 to capacity UOM '${part.capacityUom}'.`,
          rawLine,
          itemValue: uom1,
        });
      }
    }
  }

  // 7. Quantity 1 Validation
  const rawQty1 = (row.quantity1 || '').trim();
  const numQty1 = parseFloat(rawQty1.replace(/,/g, ''));
  if (!rawQty1 || isNaN(numQty1) || numQty1 <= 0) {
    errors.push({
      line: lineIndex,
      column: 'quantity1',
      fieldIndex: 9,
      code: 'ROSS_ERR_INVALID_QTY1',
      message: `QUANTITY_1 Not Valid: '${rawQty1}'. Must be a positive numeric value`,
      severity: 'error',
      remediation: 'Provide a valid quantity greater than 0.',
      rawLine,
      itemValue: rawQty1,
    });
  }

  // 8. Unit of Measure 2 & Quantity 2 (Catchweight rules)
  const uom2 = (row.uom2 || '').trim().toUpperCase();
  const rawQty2 = (row.quantity2 || '').trim();
  normalized.uom2 = uom2;

  if (part) {
    if (part.uomControl === 'C') {
      // Catchweight requires UOM2 and QTY2
      if (!uom2) {
        errors.push({
          line: lineIndex,
          column: 'uom2',
          fieldIndex: 8,
          code: 'ROSS_ERR_UOM2_REQUIRED',
          message: `Unit of Measure 2 required for Catchweight item '${partCode}'`,
          severity: 'error',
          remediation: 'Specify secondary UOM (e.g. LBS) for Catchweight item.',
          rawLine,
          itemValue: uom2,
        });
      } else if (uom2 === uom1) {
        errors.push({
          line: lineIndex,
          column: 'uom2',
          fieldIndex: 8,
          code: 'ROSS_ERR_UOM2_SAME',
          message: `Unit of Measure 2 ('${uom2}') cannot be identical to Primary UOM 1`,
          severity: 'error',
          remediation: 'Choose a different secondary UOM.',
          rawLine,
          itemValue: uom2,
        });
      }

      const numQty2 = parseFloat(rawQty2.replace(/,/g, ''));
      if (!rawQty2 || isNaN(numQty2) || numQty2 <= 0) {
        errors.push({
          line: lineIndex,
          column: 'quantity2',
          fieldIndex: 10,
          code: 'ROSS_ERR_INVALID_QTY2',
          message: `QUANTITY 2 Not Valid for Catchweight: '${rawQty2}'`,
          severity: 'error',
          remediation: 'Provide secondary quantity > 0 for catchweight products.',
          rawLine,
          itemValue: rawQty2,
        });
      }
    } else {
      // Single or Potency: UOM2 and QTY2 must be blank
      if (uom2 || rawQty2) {
        errors.push({
          line: lineIndex,
          column: 'uom2',
          fieldIndex: 8,
          code: 'WARN_UOM2_DISREGARDED',
          message: `Product '${partCode}' is not Catchweight; UOM_2 and QTY_2 will be cleared`,
          severity: 'warning',
          remediation: 'Leave UOM_2 and QTY_2 blank for single or potency items.',
          rawLine,
          itemValue: `${uom2} / ${rawQty2}`,
        });
        normalized.uom2 = '';
        normalized.quantity2 = '';
      }
    }
  }

  // 9. Unit Cost Validation
  const rawCost = (row.unitCost || '').trim().replace('$', '');
  normalized.unitCost = rawCost;
  if (rawCost) {
    const numCost = parseFloat(rawCost);
    if (isNaN(numCost) || numCost < 0) {
      errors.push({
        line: lineIndex,
        column: 'unitCost',
        fieldIndex: 12,
        code: 'ROSS_ERR_NEGATIVE_COST',
        message: 'Unit cost must not be negative',
        severity: 'error',
        remediation: 'Cost cannot be negative.',
        rawLine,
        itemValue: rawCost,
      });
    }
  }

  if (part) {
    if (['LOT', 'LIFO', 'FIFO'].includes(part.valuationMethod)) {
      if (!rawCost || parseFloat(rawCost) <= 0) {
        errors.push({
          line: lineIndex,
          column: 'unitCost',
          fieldIndex: 12,
          code: 'ROSS_ERR_COST_REQUIRED',
          message: `Unit cost must have value if ${part.valuationMethod} costed for '${partCode}'`,
          severity: 'error',
          remediation: `Enter unit cost > 0 because item valuation method is ${part.valuationMethod}.`,
          rawLine,
          itemValue: rawCost,
        });
      }
    } else {
      if (rawCost && parseFloat(rawCost) > 0) {
        errors.push({
          line: lineIndex,
          column: 'unitCost',
          fieldIndex: 12,
          code: 'INFO_COST_OVERRIDDEN',
          message: `Product uses ${part.valuationMethod} costing; file cost will default to active standard/average cost ($${part.standardCost.toFixed(2)})`,
          severity: 'info',
          remediation: 'Unit cost is informational and derived from Product Warehouse in Ross ERP.',
          rawLine,
          itemValue: rawCost,
        });
      }
    }
  }

  // 10. Dates Validation & Existing Lot Checks
  const bbDate = normalizeRossDate(row.bestBeforeDate);
  const expDate = normalizeRossDate(row.expiryDate);
  const retDate = normalizeRossDate(row.retestDate);
  const crtDate = normalizeRossDate(row.createDate);

  if (!bbDate.valid) {
    errors.push({
      line: lineIndex,
      column: 'bestBeforeDate',
      fieldIndex: 13,
      code: 'ROSS_ERR_DATE_BB',
      message: bbDate.error || 'Best Before Date Not Valid Format',
      severity: 'error',
      remediation: 'Format date as DD-MMM-YYYY (e.g. 15-JAN-2027).',
      rawLine,
      itemValue: row.bestBeforeDate,
    });
  }
  if (!expDate.valid) {
    errors.push({
      line: lineIndex,
      column: 'expiryDate',
      fieldIndex: 14,
      code: 'ROSS_ERR_DATE_EXP',
      message: expDate.error || 'Expiry Date Not Valid Format',
      severity: 'error',
      remediation: 'Format date as DD-MMM-YYYY.',
      rawLine,
      itemValue: row.expiryDate,
    });
  }
  if (!retDate.valid) {
    errors.push({
      line: lineIndex,
      column: 'retestDate',
      fieldIndex: 15,
      code: 'ROSS_ERR_DATE_RET',
      message: retDate.error || 'Retest Date Not Valid Format',
      severity: 'error',
      remediation: 'Format date as DD-MMM-YYYY.',
      rawLine,
      itemValue: row.retestDate,
    });
  }
  if (!crtDate.valid) {
    errors.push({
      line: lineIndex,
      column: 'createDate',
      fieldIndex: 16,
      code: 'ROSS_ERR_DATE_CRT',
      message: crtDate.error || 'Create Date Not Valid Format',
      severity: 'error',
      remediation: 'Format date as DD-MMM-YYYY or leave blank to default to %TODAY.',
      rawLine,
      itemValue: row.createDate,
    });
  }

  // Check if lot already exists in database
  const isExistingLot = DEFAULT_EXISTING_LOTS.some(
    (l) => l.warehouse === whCode && l.partCode === partCode && l.lotNumber === lotNumber
  );

  if (isExistingLot) {
    if (row.bestBeforeDate || row.expiryDate || row.retestDate || row.createDate) {
      errors.push({
        line: lineIndex,
        column: 'createDate',
        fieldIndex: 16,
        code: 'INFO_EXISTING_LOT_DATES',
        message: 'Setting dates to blank for existing lot in Ross ERP',
        severity: 'info',
        remediation: 'Dates are already recorded in PART_BATCHES and cannot be altered on reload.',
        rawLine,
        itemValue: lotNumber,
      });
      normalized.bestBeforeDate = '';
      normalized.expiryDate = '';
      normalized.retestDate = '';
      normalized.createDate = '';
    }
  } else {
    normalized.bestBeforeDate = bbDate.normalized;
    normalized.expiryDate = expDate.normalized;
    normalized.retestDate = retDate.normalized;
    normalized.createDate = crtDate.normalized || 'TODAY';
  }

  // 11. Supplier Lot Validation
  const suppLot = (row.supplierLot || '').trim();
  normalized.supplierLot = suppLot;
  if (suppLot.length > 20) {
    errors.push({
      line: lineIndex,
      column: 'supplierLot',
      fieldIndex: 11,
      code: 'ROSS_ERR_SUPP_LOT_LEN',
      message: `SUPPLIER_LOT Not Valid Length: exceeds 20 chars ('${suppLot}')`,
      severity: 'error',
      remediation: 'Shorten vendor lot to 20 characters maximum.',
      rawLine,
      itemValue: suppLot,
    });
  }

  // 12. License Plate Number (LPN) Validation
  const lpNumber = (row.lpNumber || '').trim();
  normalized.lpNumber = lpNumber;

  if (!lpNumber) {
    errors.push({
      line: lineIndex,
      column: 'lpNumber',
      fieldIndex: 17,
      code: 'ROSS_ERR_LPN_EMPTY',
      message: 'License Plate Number Cannot be Blank.',
      severity: 'error',
      remediation: 'Every DC inventory line must specify an LPN (up to 30 characters).',
      rawLine,
      itemValue: lpNumber,
    });
  } else if (lpNumber.length > 30) {
    errors.push({
      line: lineIndex,
      column: 'lpNumber',
      fieldIndex: 17,
      code: 'ROSS_ERR_LPN_LEN',
      message: `License Plate Number Exceeded Max Len of 30 Chars ('${lpNumber}')`,
      severity: 'error',
      remediation: 'Shorten LPN to 30 characters maximum.',
      rawLine,
      itemValue: lpNumber,
    });
  } else {
    // Check against existing database LPNs
    const existingLpn = DEFAULT_EXISTING_LPNS.find((l) => l.lpNumber === lpNumber);
    if (existingLpn) {
      if (existingLpn.status !== 'ACTIVE') {
        errors.push({
          line: lineIndex,
          column: 'lpNumber',
          fieldIndex: 17,
          code: 'ROSS_ERR_LPN_NOT_ACTIVE',
          message: `LPN Already Exists, but is not Active (Status: ${existingLpn.status})`,
          severity: 'error',
          remediation: `Re-activate LPN '${lpNumber}' in DC module or generate a new unique LPN.`,
          rawLine,
          itemValue: lpNumber,
        });
      }
      if (whCode && existingLpn.warehouse !== whCode) {
        errors.push({
          line: lineIndex,
          column: 'lpNumber',
          fieldIndex: 17,
          code: 'ROSS_ERR_LPN_DIFF_WH',
          message: `LPN Already Exists in a different warehouse: '${existingLpn.warehouse}'`,
          severity: 'error',
          remediation: `An LPN cannot exist across multiple warehouses simultaneously.`,
          rawLine,
          itemValue: `${lpNumber} in WH ${existingLpn.warehouse}`,
        });
      }
      if (binLocation && existingLpn.binLocation && existingLpn.binLocation !== binLocation) {
        errors.push({
          line: lineIndex,
          column: 'lpNumber',
          fieldIndex: 17,
          code: 'ROSS_ERR_LPN_DIFF_BIN',
          message: `LPN Already Exists in a different bin: '${existingLpn.binLocation}'`,
          severity: 'error',
          remediation: `Ensure all lines for LPN '${lpNumber}' reference bin '${existingLpn.binLocation}'.`,
          rawLine,
          itemValue: `${lpNumber} in BIN ${existingLpn.binLocation}`,
        });
      }
      if (statusCode && existingLpn.statusCode !== statusCode) {
        errors.push({
          line: lineIndex,
          column: 'lpNumber',
          fieldIndex: 17,
          code: 'ROSS_ERR_LPN_DIFF_STATUS',
          message: `LPN Lines with Different IC Status Exist on LPN: '${existingLpn.statusCode}' vs '${statusCode}'`,
          severity: 'error',
          remediation: 'All inventory lines on a given LPN must share the same status (QOH, QC, or QR).',
          rawLine,
          itemValue: lpNumber,
        });
      }
    }
  }

  const hasFatalErrors = errors.some((e) => e.severity === 'error');
  return {
    isValid: !hasFatalErrors,
    errors,
    normalizedRow: normalized,
  };
}

/**
 * Cross-file batch validation: validates consistency across the entire CSV dataset.
 * (e.g. cross-row LPN integrity: same LPN cannot have multiple warehouses, bins, or statuses in the same file)
 */
export function validateBatchIntegrity(rows: ProcessedRow[]): {
  processedRows: ProcessedRow[];
  lpnGroups: LpnGroup[];
} {
  const lpnMap = new Map<string, ProcessedRow[]>();

  // Group by LPN
  rows.forEach((r) => {
    const lpn = r.data.lpNumber?.trim();
    if (lpn) {
      const list = lpnMap.get(lpn) || [];
      list.push(r);
      lpnMap.set(lpn, list);
    }
  });

  const lpnGroups: LpnGroup[] = [];

  lpnMap.forEach((groupRows, lpn) => {
    let hasConflict = false;
    let conflictReason = '';

    const firstRow = groupRows[0];
    const firstWh = firstRow.data.warehouse;
    const firstBin = firstRow.data.binLocation;
    const firstStatus = firstRow.data.statusCode;
    const totalQty = groupRows.reduce((acc, curr) => acc + (parseFloat(curr.data.quantity1) || 0), 0);

    // Check warehouse consistency
    const whMismatch = groupRows.some((r) => r.data.warehouse !== firstWh);
    if (whMismatch) {
      hasConflict = true;
      conflictReason = `Multi-warehouse conflict: LPN '${lpn}' appears across multiple warehouses.`;
      groupRows.forEach((r) => {
        r.isValid = false;
        r.errors.push({
          line: r.lineIndex,
          column: 'lpNumber',
          fieldIndex: 17,
          code: 'CROSS_ROW_LPN_WH_CONFLICT',
          message: conflictReason,
          severity: 'error',
          remediation: `Assign all items on LPN '${lpn}' to a single warehouse.`,
          rawLine: r.raw,
          itemValue: lpn,
        });
      });
    }

    // Check bin consistency
    const binMismatch = groupRows.some((r) => r.data.binLocation !== firstBin);
    if (binMismatch) {
      hasConflict = true;
      conflictReason = `Multi-bin conflict: LPN '${lpn}' appears across multiple bin locations.`;
      groupRows.forEach((r) => {
        r.isValid = false;
        r.errors.push({
          line: r.lineIndex,
          column: 'lpNumber',
          fieldIndex: 17,
          code: 'CROSS_ROW_LPN_BIN_CONFLICT',
          message: conflictReason,
          severity: 'error',
          remediation: `Assign all items on LPN '${lpn}' to the same bin.`,
          rawLine: r.raw,
          itemValue: lpn,
        });
      });
    }

    // Check status consistency
    const statusMismatch = groupRows.some((r) => r.data.statusCode !== firstStatus);
    if (statusMismatch) {
      hasConflict = true;
      conflictReason = `Status conflict: LPN '${lpn}' has mixed status codes (QOH, QC, QR).`;
      groupRows.forEach((r) => {
        r.isValid = false;
        r.errors.push({
          line: r.lineIndex,
          column: 'lpNumber',
          fieldIndex: 17,
          code: 'CROSS_ROW_LPN_STATUS_CONFLICT',
          message: conflictReason,
          severity: 'error',
          remediation: `Ross ERP requires that all lines on an LPN have the same status code.`,
          rawLine: r.raw,
          itemValue: lpn,
        });
      });
    }

    // Assign line numbers on LPN (mirrors GET_NEXT_LPN_LINE_NUMBER in DML)
    const partLotMap = new Map<string, number>();
    let currentLineNo = 1;
    groupRows.forEach((r) => {
      const key = `${r.data.partCode}|${r.data.lotNumber}`;
      if (partLotMap.has(key)) {
        // Reuse line for same part/lot
        r.assignedLineNumber = partLotMap.get(key);
      } else {
        partLotMap.set(key, currentLineNo);
        r.assignedLineNumber = currentLineNo;
        currentLineNo++;
      }
    });

    lpnGroups.push({
      lpNumber: lpn,
      warehouse: firstWh,
      binLocation: firstBin,
      statusCode: firstStatus,
      linesCount: groupRows.length,
      totalQty1: totalQty,
      uom1: firstRow.data.uom1,
      rows: groupRows,
      hasConflict,
      conflictReason,
    });
  });

  // Re-check valid state for all rows
  rows.forEach((r) => {
    r.isValid = !r.errors.some((e) => e.severity === 'error');
    if (!r.isValid) {
      r.status = 'error';
    } else if (r.errors.some((e) => e.severity === 'warning')) {
      r.status = 'warning';
    } else {
      r.status = 'valid';
    }
  });

  return { processedRows: rows, lpnGroups };
}
