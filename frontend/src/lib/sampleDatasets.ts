export const SAMPLE_VALID_CSV = `!WH,PART,LOT,BIN,STATUS,MH,UOM1,UOM2,QTY1,QTY2,SUPP_LOT,COST,BESTBF,EXPIRY,RETEST,CREATE,LPN
!===================================================================================================
! Ross ERP DCLoader (dcload_v70_for80.dml) Test CSV Data File
! Total 17 columns per row. Comment lines begin with '!'
!
! Section 1: Single / Non-Packaged (SN), Lotted, All Status Codes (QOH, QC, QR)
! Wh 10 is Binned (Bin A-001); Wh 20 is Non-Binned
10,1000,LOT1201_1,A-001,QOH,,LBS,,10,,,,,,,,00123456781234567841
20,1000,LOT1201_2,,QOH,,LBS,,10,,,,,,,,00123456781234567851
10,1000,LOT1201_3,A-001,QC,,LBS,,10,,,,,,,,00123456781234567861
10,1000,LOT1201_4,A-001,QR,,LBS,,10,,,5.00,,,,,00123456781234567871
!
! Section 2: Single / Packaged (SP), Lotted, All Status Codes
10,2000,LOT1201_A,A-001,QOH,,CS,,10,,,,,,,,00123456781234567811
20,2000,LOT1201_B,,QOH,,CS,,10,,,,,,,,00123456781234567821
10,2000,LOT1201_C,A-001,QC,,CS,,10,,,,,,,,00123456781234567831
10,2000,LOT1201_D,A-001,QR,,CS,,10,,,25.00,,,,,00123456781234567842
!
! Section 3: Potent / Non-Packaged (PT), Lotted, All Status Codes
10,3000,LOT1201_5,A-001,QOH,,KG,,100,,,,,,,,00123456781234567741
40,3000,LOT1201_6,VAULT-01,QOH,,KG,,100,,,,,,,,00123456781234567751
10,3000,LOT1201_7,A-001,QC,,KG,,100,,,,,,,,00123456781234567761
10,3000,LOT1201_8,A-001,QR,,KG,,100,,,12.80,,,,,00123456781234567771
!
! Section 4: Potent / Packaged (PP), Lotted, All Status Codes
10,4000,LOT1201_E,A-001,QOH,,DR,,10,,,,,,,,00123456781234567641
10,4000,LOT1201_F,A-002,QOH,,DR,,10,,,,,,,,00123456781234567651
10,4000,LOT1201_G,A-001,QC,,DR,,10,,,,,,,,00123456781234567661
10,4000,LOT1201_H,A-001,QR,,DR,,10,,,60.00,,,,,00123456781234567671
!
! Section 5: Catchweight / Non-Packaged (CW) - Dual UOM (CS, LBS) & Dual Qty
10,5000,LOT1201_I,A-001,QOH,,CS,LBS,10,400,,3.20,,,,,00123456781234567541
20,5000,LOT1201_J,,QOH,,CS,LBS,10,400,,3.20,,,,,00123456781234567551
10,5000,LOT1201_K,A-001,QC,,CS,LBS,10,400,,3.20,,,,,00123456781234567561
10,5000,LOT1201_L,A-001,QR,,CS,LBS,10,400,,3.20,,,,,00123456781234567571
!
! Section 6: Catchweight / Packaged (CP) - Dual UOM (PL, LBS) & Dual Qty
10,6000,LOT1201_M,A-001,QOH,,PL,LBS,10,400,,110.00,,,,,00123456781234567441
10,6000,LOT1201_N,A-002,QOH,,PL,LBS,10,400,,110.00,,,,,00123456781234567451
10,6000,LOT1201_O,A-001,QC,,PL,LBS,10,400,,110.00,,,,,00123456781234567461
10,6000,LOT1201_P,A-001,QR,,PL,LBS,10,400,,110.00,,,,,00123456781234567471
!
! Section 7: Multi-line LPN (same LPN holding multiple lots/items in same Wh, Bin & Status)
10,1000,LOT1201_ML1,A-001,QOH,,LBS,,25,,,,,,,,LPN_MULTI_0001
10,1000,LOT1201_ML2,A-001,QOH,,LBS,,15,,,,,,,,LPN_MULTI_0001
!
! Section 8: Lot with Full Dates and Vendor Lot Number
10,1000,LOT1201_D1,A-001,QOH,,LBS,,50,,VEND_LOT_991,,31-DEC-2027,30-NOV-2027,30-JUN-2027,01-JAN-2026,00123456781234567901
`;

export const SAMPLE_ERRORS_CSV = `!WH,PART,LOT,BIN,STATUS,MH,UOM1,UOM2,QTY1,QTY2,SUPP_LOT,COST,BESTBF,EXPIRY,RETEST,CREATE,LPN
!===================================================================================================
! Ross ERP DCLoader Error Verification Test CSV Data File
! Contains known error fixtures to test quarantine handling
!
! Error 1: Bin Location required for this Warehouse (Wh 10 has Bin Sizing = Y, but bin is blank)
10,1000,LOT1201_2,,QOH,,LBS,,10,,,,,,,,00123456781234567851
!
! Error 2: Product Master is not activated (Part 9999 is inactive)
10,9999,LOT1201_B,A-001,QOH,,LBS,,10,,,,,,,,00123456781234567821
!
! Error 3: Bin location does not exist in Warehouse 10 (Bin Z-999)
10,1000,LOT1201_6,Z-999,QOH,,LBS,,100,,,,,,,,00123456781234567751
!
! Error 4: Unit of Measure 1 must be Pack UOM (P_71560 - Part 2000 passed base UOM instead of Pack UOM)
10,2000,LOT1201_F,A-001,QOH,,LBS,,10,,,,,,,,00123456781234567651
!
! Error 5: Catchweight requires dual UOM2 and Qty2 (Part 5000 missing secondary UOM & QTY)
10,5000,LOT1201_J,A-001,QOH,,CS,,10,,,,,,,,00123456781234567551
!
! Error 6: Unit cost must not be negative (-$15.00)
10,1000,LOT1201_N,A-001,QOH,,LBS,,10,,,-15.00,,,,,00123456781234567451
!
! Error 7: License Plate Number cannot be blank
10,1000,LOT1201_P,A-001,QOH,,LBS,,10,,,,,,,,
!
! Error 8: Warehouse does not have Data Capture in use (Wh 30 is non-DC)
30,1000,LOT1201_X,,QOH,,LBS,,10,,,,,,,,00123456781234567999
`;
