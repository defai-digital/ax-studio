import os
import json
import ast
import mimetypes
import re
import logging
import glob
import platform
from reportportal_client.helpers import timestamp

logger = logging.getLogger(__name__)

MAX_TEXT_LOG_BYTES = 256 * 1024
MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
UPLOAD_BINARY_ARTIFACTS = os.getenv("AUTOQA_UPLOAD_BINARY_ARTIFACTS", "false").lower() == "true"
UPLOAD_APP_LOGS = os.getenv("AUTOQA_UPLOAD_APP_LOGS", "false").lower() == "true"

SECRET_PATTERNS = [
    re.compile(r'(?i)\b(authorization|api[_-]?key|token|secret|password)\b\s*[:=]\s*["\']?([^\s,"\'}]+)'),
    re.compile(r'(?i)\b(bearer)\s+([a-z0-9\-._~+/]+=*)'),
]


def sanitize_text(value, limit_bytes=MAX_TEXT_LOG_BYTES):
    if value is None:
        return ""

    sanitized = str(value)
    for pattern in SECRET_PATTERNS:
        sanitized = pattern.sub(lambda match: f"{match.group(1)}=[REDACTED]", sanitized)

    encoded = sanitized.encode("utf-8", errors="replace")
    if len(encoded) <= limit_bytes:
        return sanitized

    truncated = encoded[:limit_bytes].decode("utf-8", errors="ignore")
    return f"{truncated}\n...[truncated]"


def sanitize_json(value):
    if isinstance(value, dict):
        sanitized = {}
        for key, nested_value in value.items():
            if re.search(r'(?i)(authorization|api[_-]?key|token|secret|password)', str(key)):
                sanitized[key] = "[REDACTED]"
            else:
                sanitized[key] = sanitize_json(nested_value)
        return sanitized

    if isinstance(value, list):
        return [sanitize_json(item) for item in value]

    if isinstance(value, str):
        return sanitize_text(value, limit_bytes=16 * 1024)

    return value


def turn_sort_key(name):
    match = re.search(r'(\d+)$', name)
    if match:
        return int(match.group(1))
    return -1


def sorted_turn_folders(names):
    return sorted(names, key=lambda name: (turn_sort_key(name), name))


def maybe_upload_attachment(client, item_id, level, message, attachment_name, attachment_data, mime_type):
    if not UPLOAD_BINARY_ARTIFACTS:
        client.log(
            time=timestamp(),
            level="INFO",
            message=f"{message} [binary attachment upload disabled]",
            item_id=item_id
        )
        return

    if len(attachment_data) > MAX_ATTACHMENT_BYTES:
        client.log(
            time=timestamp(),
            level="WARNING",
            message=f"{message} [attachment skipped: {len(attachment_data)} bytes exceeds {MAX_ATTACHMENT_BYTES} byte limit]",
            item_id=item_id
        )
        return

    client.log(
        time=timestamp(),
        level=level,
        message=message,
        item_id=item_id,
        attachment={
            "name": attachment_name,
            "data": attachment_data,
            "mime": mime_type
        }
    )


def parse_result_payload(content):
    if not content:
        return None

    for candidate in re.findall(r'\{.*?\}', content, flags=re.DOTALL):
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            try:
                parsed = ast.literal_eval(candidate)
            except (ValueError, SyntaxError):
                continue

        if isinstance(parsed, dict) and "result" in parsed and isinstance(parsed["result"], bool):
            return parsed["result"]

    return None

def upload_turn_folder(client, test_item_id, turn_path, turn_name, force_fail=False):
    """
    Upload turn folder content to ReportPortal
    """
    step_item_id = client.start_test_item(
        parent_item_id=test_item_id,
        name=turn_name,
        start_time=timestamp(),
        item_type="STEP"
    )

    uploaded = False
    step_has_errors = False  # Track if this step has any errors
    
    for fname in sorted(os.listdir(turn_path)):
        fpath = os.path.join(turn_path, fname)

        if fname.endswith(".json"):
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    data = sanitize_json(json.load(f))
                client.log(
                    time=timestamp(),
                    level="INFO",
                    message=sanitize_text(f"[{fname}]\n{json.dumps(data, indent=2)}"),
                    item_id=step_item_id
                )
                uploaded = True
            except Exception as e:
                client.log(
                    time=timestamp(),
                    level="ERROR",
                    message=f"[ERROR parsing {fname}] {str(e)}",
                    item_id=step_item_id
                )
                step_has_errors = True

        elif fname.endswith(".png"):
            try:
                with open(fpath, "rb") as img_file:
                    maybe_upload_attachment(
                        client=client,
                        item_id=step_item_id,
                        level="INFO",
                        message=f"Screenshot: {fname}",
                        attachment_name=fname,
                        attachment_data=img_file.read(),
                        mime_type=mimetypes.guess_type(fname)[0] or "image/png"
                    )
                uploaded = True
            except Exception as e:
                client.log(
                    time=timestamp(),
                    level="ERROR",
                    message=f"[ERROR attaching {fname}] {str(e)}",
                    item_id=step_item_id
                )
                step_has_errors = True

    if not uploaded:
        client.log(
            time=timestamp(),
            level="WARNING",
            message="No data found in this turn.",
            item_id=step_item_id
        )

    # Determine step status based on test case result
    if force_fail:
        step_status = "FAILED"
    else:
        step_status = "FAILED" if step_has_errors else "PASSED"
    
    client.finish_test_item(
        item_id=step_item_id,
        end_time=timestamp(),
        status=step_status
    )

def extract_test_result_from_trajectory(trajectory_dir):
    """
    Extract test result from the last turn's API response
    Returns True only if found {"result": True}, False for all other cases including {"result": False}
    """
    if not trajectory_dir or not os.path.exists(trajectory_dir):
        logger.warning(f"Trajectory directory not found: {trajectory_dir}")
        return False
    
    try:
        # Get all turn folders and find the last one
        turn_folders = [f for f in os.listdir(trajectory_dir) 
                       if os.path.isdir(os.path.join(trajectory_dir, f)) and f.startswith("turn_")]
        
        if not turn_folders:
            logger.warning("No turn folders found")
            return False
        
        # Sort to get the last turn
        last_turn = sorted_turn_folders(turn_folders)[-1]
        last_turn_path = os.path.join(trajectory_dir, last_turn)
        
        logger.info(f"Checking result in last turn: {last_turn}")
        
        # Look for API call response files
        response_files = [f for f in os.listdir(last_turn_path) 
                         if f.startswith("api_call_") and f.endswith("_response.json")]
        
        if not response_files:
            logger.warning("No API response files found in last turn")
            return False
        
        # Check the last response file
        last_response_file = sorted(response_files)[-1]
        response_file_path = os.path.join(last_turn_path, last_response_file)
        
        logger.info(f"Checking response file: {last_response_file}")
        
        with open(response_file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Extract content from response
        if 'response' in data and 'choices' in data['response'] and data['response']['choices']:
            last_choice = data['response']['choices'][-1]
            if 'message' in last_choice and 'content' in last_choice['message']:
                content = last_choice['message']['content']
                logger.info(f"Last response content preview: {sanitize_text(content, limit_bytes=1024)}")

                result = parse_result_payload(content)
                if result is True:
                    logger.info("Found test result: True - PASSED")
                    return True
                if result is False:
                    logger.info("Found test result: False - FAILED")
                    return False

                logger.warning("No valid result payload found in response content - marking as FAILED")
                return False
        
        logger.warning("Could not extract content from response structure")
        return False
        
    except Exception as e:
        logger.error(f"Error extracting test result: {e}")
        return False

def get_ax_studio_log_paths(is_nightly=False):
    """
    Get Ax-Studio application log file paths based on OS and version (nightly vs regular)
    Returns list of glob patterns for log files
    """
    system = platform.system().lower()
    app_name = "Ax-Studio-nightly" if is_nightly else "Ax-Studio"
    
    if system == "windows":
        # Windows: %APPDATA%\Ax-Studio(-nightly)\data\logs\*.log
        appdata = os.path.expandvars("%APPDATA%")
        return [f"{appdata}\\{app_name}\\data\\logs\\*.log"]
    
    elif system == "darwin":  # macOS
        # macOS: ~/Library/Application Support/Ax-Studio(-nightly)/data/logs/*.log
        home_dir = os.path.expanduser("~")
        return [f"{home_dir}/Library/Application Support/{app_name}/data/logs/*.log"]
    
    elif system == "linux":
        # Linux: ~/.local/share/Ax-Studio(-nightly)/data/logs/*.log
        home_dir = os.path.expanduser("~")
        return [f"{home_dir}/.local/share/{app_name}/data/logs/*.log"]
    
    else:
        logger.warning(f"Unsupported OS: {system}")
        return []

def upload_ax_studio_logs(client, test_item_id, is_nightly=False, max_log_files=5):
    """
    Upload Ax-Studio application log files to ReportPortal
    """
    app_type = "nightly" if is_nightly else "regular"

    if not UPLOAD_APP_LOGS:
        client.log(
            time=timestamp(),
            level="INFO",
            message=f"[INFO] Ax-Studio {app_type} application log upload disabled",
            item_id=test_item_id
        )
        return

    log_patterns = get_ax_studio_log_paths(is_nightly)
    
    logger.info(f"Looking for Ax-Studio {app_type} logs...")
    
    all_log_files = []
    for pattern in log_patterns:
        try:
            log_files = glob.glob(pattern)
            all_log_files.extend(log_files)
            logger.info(f"Found {len(log_files)} log files matching pattern: {pattern}")
        except Exception as e:
            logger.error(f"Error searching for logs with pattern {pattern}: {e}")
    
    if not all_log_files:
        logger.warning(f"No Ax-Studio {app_type} log files found")
        client.log(
            time=timestamp(),
            level="WARNING",
            message=f"[INFO] No Ax-Studio {app_type} application logs found",
            item_id=test_item_id
        )
        return
    
    # Sort by modification time (newest first) and limit to max_log_files
    try:
        all_log_files.sort(key=lambda x: os.path.getmtime(x), reverse=True)
        log_files_to_upload = all_log_files[:max_log_files]
        
        logger.info(f"Uploading {len(log_files_to_upload)} most recent Ax-Studio {app_type} log files")
        
        for i, log_file in enumerate(log_files_to_upload, 1):
            try:
                file_size = os.path.getsize(log_file)
                file_name = os.path.basename(log_file)
                
                max_file_size = MAX_ATTACHMENT_BYTES
                if file_size > max_file_size:
                    logger.warning(f"Log file {file_name} is too large ({file_size} bytes > {max_file_size} bytes), skipping upload")
                    client.log(
                        time=timestamp(),
                        level="WARNING",
                        message=f"[INFO] Log file {file_name} skipped (size: {file_size} bytes exceeds upload limit)",
                        item_id=test_item_id
                    )
                    continue
                
                logger.info(f"Uploading log file {i}/{len(log_files_to_upload)}: {file_name} ({file_size} bytes)")
                
                # Read log file content (safe to read since we checked size)
                with open(log_file, 'r', encoding='utf-8', errors='ignore') as f:
                    log_content = sanitize_text(f.read())
                
                maybe_upload_attachment(
                    client=client,
                    item_id=test_item_id,
                    level="INFO",
                    message=f"[INFO] Ax-Studio {app_type} application log: {file_name}",
                    attachment_name=f"ax_studio_{app_type}_log_{i}_{file_name}",
                    attachment_data=log_content.encode('utf-8'),
                    mime_type="text/plain"
                )
                
                logger.info(f"Successfully uploaded log: {file_name}")
                
            except Exception as e:
                logger.error(f"Error uploading log file {log_file}: {e}")
                client.log(
                    time=timestamp(),
                    level="ERROR",
                    message=f"Failed to upload log file {os.path.basename(log_file)}: {str(e)}",
                    item_id=test_item_id
                )
        
        # Add summary log
        client.log(
            time=timestamp(),
            level="INFO",
            message=f"[INFO] Uploaded {len(log_files_to_upload)} Ax-Studio {app_type} log files (total available: {len(all_log_files)})",
            item_id=test_item_id
        )
        
    except Exception as e:
        logger.error(f"Error processing Ax-Studio logs: {e}")
        client.log(
            time=timestamp(),
            level="ERROR",
            message=f"Error processing Ax-Studio {app_type} logs: {str(e)}",
            item_id=test_item_id
        )

def upload_test_results_to_rp(client, launch_id, test_path, trajectory_dir, force_stopped=False, video_path=None, is_nightly=False):
    """
    Upload test results to ReportPortal with proper status based on test result
    """
    if not trajectory_dir or not os.path.exists(trajectory_dir):
        logger.warning(f"Trajectory directory not found: {trajectory_dir}")
        formatted_test_path = test_path.replace('\\', '/').replace('.txt', '').replace('/', '__')
        test_item_id = client.start_test_item(
            launch_id=launch_id,
            name=formatted_test_path,
            start_time=timestamp(),
            item_type="TEST",
            description=f"Test case from: {test_path}"
        )
        client.log(
            time=timestamp(),
            level="ERROR",
            message="[FAILED] TEST FAILED [FAILED]\nNo trajectory directory found",
            item_id=test_item_id
        )
        
        # Upload video if available
        if video_path and os.path.exists(video_path):
            try:
                with open(video_path, "rb") as video_file:
                    maybe_upload_attachment(
                        client=client,
                        item_id=test_item_id,
                        level="INFO",
                        message="Screen recording of test execution",
                        attachment_name=f"test_recording_{formatted_test_path}.mp4",
                        attachment_data=video_file.read(),
                        mime_type="video/mp4"
                    )
                logger.info(f"Uploaded video for failed test: {video_path}")
            except Exception as e:
                logger.error(f"Error uploading video: {e}")
        
        client.finish_test_item(
            item_id=test_item_id,
            end_time=timestamp(),
            status="FAILED"
        )
        return
    
    formatted_test_path = test_path.replace('\\', '/').replace('.txt', '').replace('/', '__')
    
    # Determine final status
    if force_stopped:
        final_status = "FAILED"
        status_message = "exceeded maximum turn limit (30 turns)"
    else:
        test_result = extract_test_result_from_trajectory(trajectory_dir)
        if test_result is True:
            final_status = "PASSED" 
            status_message = "completed successfully with positive result"
        else:
            final_status = "FAILED"
            status_message = "no valid success result found"
    
    # Create test item
    test_item_id = client.start_test_item(
        launch_id=launch_id,
        name=formatted_test_path,
        start_time=timestamp(),
        item_type="TEST",
        description=f"Test case from: {test_path}"
    )
    
    try:
        turn_folders = [f for f in os.listdir(trajectory_dir) 
                       if os.path.isdir(os.path.join(trajectory_dir, f)) and f.startswith("turn_")]
        
        # Add clear status log
        status_emoji = "[SUCCESS]" if final_status == "PASSED" else "[FAILED]"
        client.log(
            time=timestamp(),
            level="INFO" if final_status == "PASSED" else "ERROR",
            message=f"{status_emoji} TEST {final_status} {status_emoji}\nReason: {status_message}\nTotal turns: {len(turn_folders)}",
            item_id=test_item_id
        )
        
        # Upload screen recording video first
        if video_path and os.path.exists(video_path):
            logger.info(f"Attempting to upload video: {video_path}")
            logger.info(f"Video file size: {os.path.getsize(video_path)} bytes")
            try:
                with open(video_path, "rb") as video_file:
                    video_data = video_file.read()
                    logger.info(f"Read video data: {len(video_data)} bytes")
                    maybe_upload_attachment(
                        client=client,
                        item_id=test_item_id,
                        level="INFO",
                        message="[INFO] Screen recording of test execution",
                        attachment_name=f"test_recording_{formatted_test_path}.mp4",
                        attachment_data=video_data,
                        mime_type="video/mp4"
                    )
                logger.info(f"Successfully uploaded screen recording: {video_path}")
            except Exception as e:
                logger.error(f"Error uploading screen recording: {e}")
                client.log(
                    time=timestamp(),
                    level="WARNING",
                    message=f"Failed to upload screen recording: {str(e)}",
                    item_id=test_item_id
                )
        else:
            logger.warning(f"Video upload skipped - video_path: {video_path}, exists: {os.path.exists(video_path) if video_path else 'N/A'}")
            client.log(
                time=timestamp(),
                level="WARNING",
                message="No screen recording available for this test",
                item_id=test_item_id
            )
        
        # Upload Ax-Studio application logs
        logger.info("Uploading Ax-Studio application logs...")
        upload_ax_studio_logs(client, test_item_id, is_nightly=is_nightly, max_log_files=5)
        
        # Upload all turn data with appropriate status
        # If test failed, mark all turns as failed
        force_fail_turns = (final_status == "FAILED")
        
        for turn_folder in sorted_turn_folders(turn_folders):
            turn_path = os.path.join(trajectory_dir, turn_folder)
            upload_turn_folder(client, test_item_id, turn_path, turn_folder, force_fail=force_fail_turns)
        
        # Finish with correct status
        client.finish_test_item(
            item_id=test_item_id,
            end_time=timestamp(),
            status=final_status
        )
        
        logger.info(f"Uploaded test results for {formatted_test_path}: {final_status}")
        
    except Exception as e:
        logger.error(f"Error uploading test results: {e}")
        client.finish_test_item(
            item_id=test_item_id,
            end_time=timestamp(),
            status="FAILED"
        )
