-- S76: keep outer routes' danger from dropping as tier rises.
UPDATE places SET danger = 'medium'
WHERE split_part(id, ':', 3) IN ('xiuxian_out_mist_slope', 'xiuxian_out_reed_path', 'scifi_out_dune_edge', 'scifi_out_beacon_spur');
