import os
import json
import logging

logger = logging.getLogger("lab_config")

CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "lab_config.json")

def get_lab_config():
    """Reads lab configuration from JSON file, fallback to environment variable or '304'."""
    default_lab = os.environ.get("LAB_ID", "304")
    default_node = os.environ.get("NODE_ID", "rpi5-node1")
    
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                lab_code = str(data.get("lab_code", default_lab)).strip()
                node_id = str(data.get("node_id", default_node)).strip()
                lab_name = str(data.get("lab_name", f"Lab {lab_code}")).strip()
                activation_code = str(data.get("activation_code", "")).strip()
                is_activated = bool(data.get("is_activated", False))
                activated_at = str(data.get("activated_at", "")).strip()
                activated_by = str(data.get("activated_by", "")).strip()
                
                os.environ["LAB_ID"] = lab_code
                os.environ["NODE_ID"] = node_id
                return {
                    "lab_code": lab_code,
                    "lab_name": lab_name,
                    "activation_code": activation_code,
                    "is_activated": is_activated,
                    "activated_at": activated_at,
                    "activated_by": activated_by,
                    "node_id": node_id
                }
        except Exception as e:
            logger.error(f"Error reading lab_config.json: {e}")

    # Fallback default
    os.environ["LAB_ID"] = default_lab
    os.environ["NODE_ID"] = default_node
    return {
        "lab_code": default_lab,
        "lab_name": f"Lab {default_lab}",
        "activation_code": "",
        "is_activated": False,
        "activated_at": "",
        "activated_by": "",
        "node_id": default_node
    }

def save_lab_config(lab_code, lab_name=None, activation_code=None, is_activated=True, activated_at=None, activated_by=None, node_id=None):
    """Saves updated lab configuration to JSON file and updates process environment variables."""
    cfg = get_lab_config()
    clean_code = str(lab_code).strip()
    if not clean_code:
        clean_code = "304"
        
    cfg["lab_code"] = clean_code
    if lab_name:
        cfg["lab_name"] = str(lab_name).strip()
    else:
        cfg["lab_name"] = f"Lab {clean_code}"
        
    if activation_code is not None:
        cfg["activation_code"] = str(activation_code).strip()
        
    cfg["is_activated"] = bool(is_activated)
    if activated_at is not None:
        cfg["activated_at"] = str(activated_at).strip()
    if activated_by is not None:
        cfg["activated_by"] = str(activated_by).strip()

    if node_id:
        cfg["node_id"] = str(node_id).strip()

    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
        os.environ["LAB_ID"] = cfg["lab_code"]
        os.environ["NODE_ID"] = cfg["node_id"]
        logger.info(f"Updated Lab Configuration: Code='{cfg['lab_code']}', ActivatedAt='{cfg.get('activated_at')}', ActivatedBy='{cfg.get('activated_by')}'")
        return True
    except Exception as e:
        logger.error(f"Error writing lab_config.json: {e}")
        return False
